import path from 'path';
import { saveNote, today } from './notes';
import type { SaveNoteInput, SaveMode } from './notes';
import type { MetricsSummary } from '@ai/metrics';

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

// agents/<model>.md: what each local model is good at, from the real usage metrics.
export async function noteAgentPerformance(summary: MetricsSummary, days: number): Promise<void> {
  const models = Array.from(new Set(summary.models.map((row) => row.model)));

  for (const model of models) {
    const rows = summary.models.filter((row) => row.model === model);
    const table = [
      '| tarefa | chamadas | falhas | tempo médio | aprovação |',
      '|---|---|---|---|---|',
      ...rows.map((row) => `| ${row.task} | ${row.calls} | ${row.failures} | ${row.avgSeconds.toFixed(1)}s | ${percent(row.approved, row.rejected)} |`),
    ].join('\n');

    await trySave(
      {
        category: 'agents',
        title: model.replace(/:latest$/, ''),
        body: `Desempenho nos últimos ${days} dias (atualizado em ${today()} pelo \`kvasir learn\`):\n\n${table}`,
        origin: 'kvasir learn',
        tags: ['agente'],
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
