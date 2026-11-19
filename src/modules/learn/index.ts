import { askFor } from '@ai/router';
import { cleanAnswer } from '@ai/parse';
import { readMetrics, recordOutcome, summarizeMetrics } from '@ai/metrics';
import { globalProfilePath, preferencesSection, projectProfilePath, readProjectPreferences, withPreferences, PREFERENCES_HEADING } from '@ai/profile';
import { writeFile, readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { formatDiff, lineDiff } from '@utils/diff';
import { currentProject } from '@utils/project';
import { noteAgentPerformance } from '@modules/knowledge/auto';
import type { FeedbackCategory } from '@ktypes/feedback';
import { markLearned, readFeedbackEntries, LEARN_CATEGORIES } from './state';
import type { FeedbackEntry } from './state';

// The local context window (8k tokens) also holds the preferences and the answer: the newest verdicts
// only, each cut to a line. The older ones are already in the profile.
const MAX_FEEDBACK_ENTRIES = 60;
const MAX_SUMMARY_CHARS = 180;
const AGENT_STATS_DAYS = 30;
// the reasoning model thinks before answering: room for both, and time for a cold start
const LEARN_MAX_TOKENS = 3000;
const LEARN_TIMEOUT_MS = 300_000;
// a preference is the developer's (not one project's) only when more than one project shows it
const MIN_PROJECTS_FOR_GLOBAL = 2;
const NONE_ANSWER = /^\(?nenhuma\)?\.?$/i;

const CATEGORY_TITLES: Partial<Record<FeedbackCategory, string>> = {
  commits: 'Mensagens de commit sugeridas',
  branches: 'Nomes de branch sugeridos',
  fixes: 'Correções sugeridas (fix)',
  patterns: 'Revisões de código (review)',
};

function defaultGlobalProfile(): string {
  return `# profile.md\n\n${PREFERENCES_HEADING}\n\n## Stack pessoal\n`;
}

function defaultProjectProfile(project: string): string {
  return `# ${project}\n\n${PREFERENCES_HEADING}\n`;
}

function shorten(text: string): string {
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS)}…`;
}

// Grouped by kind and spelled out ("aceitou" / "recusou … porque"): with the raw "REJECTED: fix(x): …" lines,
// the model read a refused suggestion as the developer's style ("usa prefixo" after he refused prefixes).
function describeFeedback(entries: FeedbackEntry[]): string {
  return LEARN_CATEGORIES.flatMap((category) => {
    const ofCategory = entries.filter((entry) => entry.category === category);
    if (ofCategory.length === 0) return [];
    const lines = ofCategory.map((entry) =>
      entry.approved
        ? `- aceitou: "${shorten(entry.summary)}"`
        : `- recusou: "${shorten(entry.summary)}"${entry.reason ? ` — porque: ${entry.reason}` : ''}`
    );
    return [`${CATEGORY_TITLES[category] ?? category}:\n${lines.join('\n')}`];
  }).join('\n\n');
}

const LIST_ANSWER = 'Responda só com a lista, um item curto em português por linha, cada linha começando com "- ".';

// Data first, instructions and the exact output shape last. Only the list is asked for: rewriting the
// whole file, the model dropped sections ("## Stack pessoal") and merged everything it saw.
function buildProjectPrompt(project: string, current: string, feedback: string): string {
  return `O que um desenvolvedor fez com as sugestões de IA no projeto "${project}" ("recusou" inclui quando ele editou; "→ editada para" mostra o que ele escreveu no lugar):

${feedback}

Preferências já anotadas para este projeto:
${current || '(nenhuma ainda)'}

Escreva a lista de preferências deste projeto: o que ele aceita, e o oposto do que ele recusa (se recusou mensagens em inglês, a preferência é português). O "porque" escrito por ele é a evidência mais forte. Mantenha as já anotadas que o feedback não contradiz. Não invente nada que o feedback não mostre.

${LIST_ANSWER}`;
}

// The global profile comes from the project profiles side by side, not from the raw feedback: comparing
// short lists is what a local model does well, and only what repeats is the developer's own taste.
function buildGlobalPrompt(current: string, projects: { project: string; preferences: string }[]): string {
  const listing = projects.map((item) => `Projeto ${item.project}:\n${item.preferences}`).join('\n\n');
  return `Preferências que um desenvolvedor mostrou em cada um dos seus projetos:

${listing}

Preferências gerais já anotadas:
${current || '(nenhuma ainda)'}

Escreva a lista de preferências GERAIS: o que pelo menos ${MIN_PROJECTS_FOR_GLOBAL} projetos dizem com o mesmo sentido, mesmo com palavras diferentes. Quando um projeto diz uma coisa e outro diz o contrário (ex.: idioma do commit), isso é de cada projeto e NÃO entra. Mantenha as já anotadas que os projetos não contradizem. Se nada se repete, responda só "- (nenhuma)".

${LIST_ANSWER}`;
}

// Only the "- item" lines: a preamble or a closing sentence of the model is not a preference.
function parseItems(answer: string): string[] {
  const items = cleanAnswer(answer)
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    // "- - item" and '- "- item"': some answers nest the marker or quote the whole item
    .map((line) => line.replace(/^\s*(?:[-*]\s+)+/, '').replace(/^["“'](.*)["”']$/, '$1').replace(/^(?:[-*]\s+)+/, '').trim())
    .filter((item) => item && !NONE_ANSWER.test(item));
  return [...new Set(items)];
}

// Proposes the new preferences, shows only what changes and saves them on "yes". True when saved.
async function updateProfile(label: string, filePath: string, fallback: string, buildPrompt: (current: string) => string): Promise<boolean> {
  const profile = (await readFile(filePath)) ?? fallback;
  const current = preferencesSection(profile);
  const answer = await askFor('learn', buildPrompt(current), { temperature: 0.2, maxTokens: LEARN_MAX_TOKENS, timeoutMs: LEARN_TIMEOUT_MS });
  const items = parseItems(answer);
  const currentItems = current.split('\n').map((line) => line.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);

  // an empty list would wipe the profile: the model found nothing to say, not that everything is wrong
  if (items.length === 0 || items.join('\n') === currentItems.join('\n')) {
    console.log(`Nada novo para ${label}.`);
    return false;
  }

  console.log(`\nMudanças propostas para ${label}:\n`);
  console.log(formatDiff(lineDiff(currentItems.map((item) => `- ${item}`), items.map((item) => `- ${item}`))));

  const approved = await confirm(`Salvar em ${filePath}?`);
  await recordOutcome('learn', approved ? 'approved' : 'rejected');
  if (!approved) {
    console.log('Perfil não alterado.');
    return false;
  }
  await writeFile(filePath, withPreferences(profile, items));
  console.log(`✅ ${label} atualizado.`);
  return true;
}

export async function runLearn(): Promise<void> {
  const project = currentProject();
  // verdicts from before feedback carried the project are left out: no way to tell whose taste they show
  const own = (await readFeedbackEntries()).filter((entry) => entry.project === project).slice(-MAX_FEEDBACK_ENTRIES);

  if (own.length === 0) {
    console.log(`Nenhum feedback deste projeto (${project}) ainda. Use commit, branch, fix e review aqui e o Kvasir aprende sozinho.`);
    return;
  }

  console.log(`\nAnalisando ${own.length} veredito(s) de ${project} com a IA local (pode levar um minuto)...`);
  const feedback = describeFeedback(own);
  const saved = await updateProfile(`o perfil de ${project}`, projectProfilePath(project), defaultProjectProfile(project), (current) =>
    buildProjectPrompt(project, current, feedback)
  );
  // the verdicts are consolidated whatever the answer: the next offer counts only what comes after
  await markLearned(project);
  if (!saved) return;

  // the global profile changes only when a project profile did, and needs two projects to compare
  const projects = await readProjectPreferences();
  if (projects.length >= MIN_PROJECTS_FOR_GLOBAL) {
    console.log(`\nComparando ${projects.length} projetos para o perfil geral...`);
    await updateProfile('o perfil geral', globalProfilePath(), defaultGlobalProfile(), (current) => buildGlobalPrompt(current, projects));
  }

  // What each agent of the team did, from real usage: knowledge/agents/<agent>.md.
  const summary = summarizeMetrics(await readMetrics(AGENT_STATS_DAYS));
  if (summary.models.length > 0) await noteAgentPerformance(summary, AGENT_STATS_DAYS);
}
