import os from 'os';
import path from 'path';
import { askFor } from '@ai/router';
import { cleanAnswer } from '@ai/parse';
import { readMetrics, recordOutcome, summarizeMetrics } from '@ai/metrics';
import { writeFile, readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { formatDiff, lineDiff } from '@utils/diff';
import { noteAgentPerformance } from '@modules/knowledge/auto';
import { markLearned, readFeedbackEntries } from './state';

// The local context window (8k tokens) also holds the profile and the answer: the newest verdicts only,
// each cut to a line. The older ones are already in the profile.
const MAX_FEEDBACK_ENTRIES = 60;
const MAX_ENTRY_CHARS = 220;
const AGENT_STATS_DAYS = 30;
const DEFAULT_PROFILE = '# profile.md\n\n## Preferências aprendidas\n\n## Stack pessoal\n';

function getProfilePath(): string {
  return path.join(os.homedir(), '.kvasir', 'profile.md');
}

function shorten(entry: string): string {
  return entry.length <= MAX_ENTRY_CHARS ? entry : `${entry.slice(0, MAX_ENTRY_CHARS)}…`;
}

// Data first, instructions and the exact output shape last: what works with local models.
function buildLearnPrompt(currentProfile: string, entries: string[]): string {
  return `Feedback recente de um desenvolvedor sobre sugestões de IA (APPROVED = aceitou, REJECTED = recusou ou editou; "(motivo: …)" = o porquê, nas palavras dele):
${entries.join('\n')}

Perfil atual dele (profile.md):
${currentProfile}

Atualize o perfil com as preferências que o feedback mostra de forma consistente (ex.: estilo de mensagem de commit que ele aprova, nomes de branch que recusa, tipos de aviso de review que ignora). Um motivo escrito por ele é a evidência mais forte: um único motivo claro já pode virar item do perfil.

Regras:
- Mantenha as seções existentes e os itens que o feedback não contradiz; só acrescente ou refine itens
- Não invente preferências que o feedback não sustenta; sem novidade, devolva o perfil igual
- Itens curtos, em português, em "## Preferências aprendidas"

Responda só com o conteúdo COMPLETO do novo profile.md, começando por "# profile.md", sem comentários antes ou depois.`;
}

// Models wrap the file in a code fence or add a sentence before it: keep only the markdown.
function extractProfile(answer: string): string {
  const clean = cleanAnswer(answer);
  const fence = clean.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
  const body = fence ? fence[1] : clean;
  const headingIndex = body.search(/^# /m);
  return `${(headingIndex >= 0 ? body.slice(headingIndex) : body).trim()}\n`;
}

export async function runLearn(): Promise<void> {
  const entries = (await readFeedbackEntries()).slice(-MAX_FEEDBACK_ENTRIES).map(shorten);

  if (entries.length === 0) {
    console.log('Nenhum feedback registrado ainda. Use commit, branch, fix e review e o Kvasir aprende sozinho.');
    return;
  }

  const currentProfile = (await readFile(getProfilePath())) ?? DEFAULT_PROFILE;
  console.log(`\nAnalisando ${entries.length} registro(s) de feedback com a IA local...`);

  const updatedProfile = extractProfile(await askFor('learn', buildLearnPrompt(currentProfile, entries), { temperature: 0.2, maxTokens: 1500 }));
  // the verdicts are consolidated whatever the answer: the next offer counts only what comes after
  await markLearned();

  if (updatedProfile.trim() === currentProfile.trim()) {
    console.log('Nada novo para o perfil: o feedback recente confirma o que ele já diz.');
    return;
  }

  console.log('\nMudanças propostas no perfil:\n');
  console.log(formatDiff(lineDiff(currentProfile.split('\n'), updatedProfile.split('\n'))));

  const approved = await confirm(`Salvar em ${getProfilePath()}?`);
  await recordOutcome('learn', approved ? 'approved' : 'rejected');
  if (!approved) {
    console.log('Perfil não alterado.');
    return;
  }

  await writeFile(getProfilePath(), updatedProfile);
  console.log('✅ profile.md atualizado.');

  // What each agent of the team did, from real usage: knowledge/agents/<agent>.md.
  const summary = summarizeMetrics(await readMetrics(AGENT_STATS_DAYS));
  if (summary.models.length > 0) await noteAgentPerformance(summary, AGENT_STATS_DAYS);
}
