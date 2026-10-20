import path from 'path';
import { saveNote, readNote, today } from './notes';
import type { SaveNoteInput, SaveMode } from './notes';
import type { MetricsSummary } from '@ai/metrics';
import { AGENTS, AGENT_NAMES, TASK_OWNER } from '@ai/agents';
import type { AiTask } from '@ai/router';

// Notes the other modules write on their own ("conhecimento gerado uma vez fica salvo").
// Writing a note must never break the command that produced it.

function currentProject(): string {
  return path.basename(process.cwd());
}

// global = not tied to a project (e.g. agent notes).
async function trySave(input: Omit<SaveNoteInput, 'project'>, mode: SaveMode, global: boolean = false): Promise<void> {
  try {
    const saved = await saveNote(global ? input : { ...input, project: currentProject() }, mode);
    console.log(`📚 Nota salva no knowledge: ${saved}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`⚠️  Não foi possível salvar a nota no knowledge (${message}).`);
  }
}

function codeBlock(text: string): string {
  return `\`${text.trim().replace(/`/g, "'")}\``;
}

export interface FixedErrorNote {
  code: string;
  message: string;
  filePath: string;
  line: number;
  before: string;
  after: string;
  source: string;
}

// errors/<code>.md collects every occurrence of a TS error: later used to detect recurring errors.
export async function noteFixedError(fix: FixedErrorNote): Promise<void> {
  const body = [
    `## ${today()} · ${currentProject()} · ${fix.filePath}:${fix.line}`,
    '',
    `> ${fix.message}`,
    '',
    `- corrigido por: ${fix.source}`,
    `- antes: ${codeBlock(fix.before)}`,
    `- depois: ${codeBlock(fix.after)}`,
  ].join('\n');

  await trySave({ category: 'errors', title: fix.code, body, origin: 'kvasir fix', tags: ['erro', fix.code] }, 'append');
}

export async function noteBatchFix(code: string, fixed: number, total: number, files: string[]): Promise<void> {
  const body = [
    `## ${today()} · ${currentProject()} · expansão: ${fixed}/${total} corrigido(s)`,
    '',
    ...files.slice(0, 20).map((file) => `- ${file}`),
    ...(files.length > 20 ? [`- … e mais ${files.length - 20}`] : []),
  ].join('\n');

  await trySave({ category: 'errors', title: code, body, origin: 'kvasir fix', tags: ['erro', code] }, 'append');
}

export async function noteInvestigation(code: string | null, erro: string, report: string): Promise<void> {
  const body = [
    `## ${today()} · ${currentProject()} · investigação de causa raiz`,
    '',
    '```',
    erro.trim().split('\n').slice(0, 10).join('\n'),
    '```',
    '',
    report.trim().replace(/^## /gm, '### '),
  ].join('\n');

  await trySave(
    { category: 'errors', title: code ?? 'outros-erros', body, origin: 'kvasir fix (architect)', tags: ['erro', 'causa-raiz', ...(code ? [code] : [])] },
    'append'
  );
}

export async function noteCommit(message: string, hash: string, branch: string): Promise<void> {
  await trySave(
    {
      category: 'commits',
      title: currentProject(),
      body: `- ${today()} · \`${hash}\` · ${branch} · ${message}`,
      origin: 'kvasir commit',
      tags: ['commit'],
    },
    'append'
  );
}

export interface TaskNote {
  id: string;
  title: string;
  status?: string;
  linkedBranch?: string;
}

export async function noteTaskActivated(task: TaskNote): Promise<void> {
  const body = `- ${today()} · ativada em ${currentProject()}${task.status ? ` · status: ${task.status}` : ''}\n  - ${task.title}`;
  await trySave({ category: 'tasks', title: task.id, body, origin: 'kvasir task', tags: ['task'] }, 'append');
}

export async function noteTaskBranch(taskId: string, branch: string): Promise<void> {
  await trySave(
    { category: 'tasks', title: taskId, body: `- ${today()} · branch: \`${branch}\``, origin: 'kvasir task', tags: ['task'] },
    'append'
  );
}

// Only reviews the developer found useful become knowledge.
export async function noteUsefulReview(findings: string[]): Promise<void> {
  const body = [`## ${today()}`, '', ...findings].join('\n');
  await trySave(
    { category: 'patterns', title: `review-${currentProject()}`, body, origin: 'kvasir review', tags: ['review'] },
    'append'
  );
}

function percent(approved: number, rejected: number): string {
  const total = approved + rejected;
  return total === 0 ? '—' : `${Math.round((approved / total) * 100)}% (${approved}/${total})`;
}

// agents/<agent>.md: what each agent of the team did and which of its models did best, from the
// real usage metrics. One note per agent (Arquiteto, Revisor...), never mixing another agent's tasks.
export async function noteAgentPerformance(summary: MetricsSummary, days: number): Promise<void> {
  for (const name of AGENT_NAMES) {
    const agent = AGENTS[name];
    const rows = summary.models.filter((row) => TASK_OWNER[row.task as AiTask] === name);
    if (rows.length === 0) continue;

    const table = [
      '| tarefa | modelo | chamadas | falhas | tempo médio | aprovação |',
      '|---|---|---|---|---|---|',
      ...rows.map((row) => {
        const model = row.provider === 'ollama' ? row.model.replace(/:latest$/, '') : `${row.provider}/${row.model}`;
        return `| ${row.task} | ${model} | ${row.calls} | ${row.failures} | ${row.avgSeconds.toFixed(1)}s | ${percent(row.approved, row.rejected)} |`;
      }),
    ].join('\n');

    await trySave(
      {
        category: 'agents',
        title: agent.label.toLowerCase(),
        body: `**${agent.label}**: ${agent.role}.\n\nDesempenho nos últimos ${days} dias (atualizado em ${today()} pelo \`kvasir learn\`):\n\n${table}`,
        origin: 'kvasir learn',
        tags: ['agente', name],
      },
      'replace',
      true
    );
  }
}

export async function notePullRequest(taskId: string, title: string, url: string): Promise<void> {
  await trySave(
    { category: 'tasks', title: taskId, body: `- ${today()} · PR: [${title}](${url})`, origin: 'kvasir task', tags: ['task', 'pr'] },
    'append'
  );
}

// commits/daily.md: the personal log of what was reported (not tied to one project).
export async function noteDaily(message: string): Promise<void> {
  await trySave(
    { category: 'commits', title: 'daily', body: message.replace(/^\*\*(Daily · .+)\*\*$/m, '## $1'), origin: 'kvasir daily', tags: ['daily'] },
    'append',
    true
  );
}

export async function noteRelease(version: string, changelogSection: string): Promise<void> {
  await trySave(
    {
      category: 'commits',
      title: currentProject(),
      body: changelogSection.replace(/^## /m, '## Release ').replace(/^### /gm, '#### '),
      origin: 'kvasir release',
      tags: ['release', `v${version}`],
    },
    'append'
  );
}

// errors/bugs-encontrados-por-testes.md: bugs a generated test exposed (to fix later with kvasir fix).
export async function noteBugFoundByTest(sourceFile: string, explanation: string): Promise<void> {
  await trySave(
    {
      category: 'errors',
      title: 'bugs-encontrados-por-testes',
      body: `- ${today()} · ${currentProject()} · \`${sourceFile}\`: ${explanation}`,
      origin: 'kvasir test',
      tags: ['bug', 'teste'],
    },
    'append'
  );
}

export interface RecentOccurrences {
  count: number;
  files: string[];
}

// Occurrences of an error code in the last `days`, read from errors/<code>.md: one per
// "## <date> · <project> · <file>:<line>" entry, N per "expansão: N/M" entry; investigations don't count.
export async function recentErrorOccurrences(code: string, days: number): Promise<RecentOccurrences> {
  const note = await readNote('errors', code);
  if (!note) return { count: 0, files: [] };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const files: string[] = [];
  let count = 0;

  for (const match of note.body.matchAll(/^## (\d{4}-\d{2}-\d{2}) · [^·]+ · (.+)$/gm)) {
    const [, date, detail] = match;
    if (date < since || /investiga/i.test(detail)) continue;

    const batch = detail.match(/expans[aã]o: (\d+)\//);
    if (batch) {
      count += Number(batch[1]);
    } else {
      count += 1;
      files.push(detail.trim());
    }
  }

  return { count, files };
}

export interface KnownFixEntry {
  message: string;
  before: string;
  after: string;
}

// The last fixes of an error code that were applied (errors/<code>.md): examples for the next fix of
// the same code, so a solution found once is reused instead of re-discovered ("zero token desperdiçado").
export async function knownFixesFor(code: string, limit: number): Promise<KnownFixEntry[]> {
  const note = await readNote('errors', code);
  if (!note) return [];

  const fixes: KnownFixEntry[] = [];
  for (const entry of note.body.split(/^## /m).slice(1)) {
    const message = entry.match(/^> (.+)$/m)?.[1];
    const before = entry.match(/^- antes: `(.*)`$/m)?.[1];
    const after = entry.match(/^- depois: `(.*)`$/m)?.[1];
    if (message && before !== undefined && after !== undefined && before !== after) fixes.push({ message, before, after });
  }
  return fixes.slice(-limit);
}

export interface AnswerNote {
  question: string;
  answer: string;
  // "src/cart.ts:12-40" for code, "libs/zod" for knowledge notes used as sources
  sources: string[];
  knowledgeNotes: string[];
}

const MAX_TITLE_CHARS = 80;

// answers/<question>.md: an answer the developer said helped (kvasir ask), so the next similar
// question finds it instead of spending tokens again. Linked to the knowledge notes it used.
export async function noteAnswer(note: AnswerNote): Promise<void> {
  const title = note.question.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS);
  const links = note.knowledgeNotes.length > 0 ? `\n\nRelacionado: ${note.knowledgeNotes.map((name) => `[[${name}]]`).join(' ')}` : '';
  const body = [
    `**Pergunta:** ${note.question.trim()}`,
    '',
    note.answer.trim(),
    '',
    `**Fontes** (respondido em ${today()}):`,
    ...note.sources.map((source) => `- \`${source}\``),
  ].join('\n');

  await trySave({ category: 'answers', title, body: `${body}${links}`, origin: 'kvasir ask', tags: ['resposta'] }, 'replace');
}
