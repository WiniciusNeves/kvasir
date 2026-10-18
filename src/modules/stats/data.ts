import os from 'os';
import path from 'path';
import { readMetrics, summarizeMetrics } from '@ai/metrics';
import type { AiCallRecord, AiOutcomeRecord, MetricsRecord, ModelPerformance } from '@ai/metrics';
import { AGENTS, AGENT_NAMES, TASK_OWNER, tasksOf } from '@ai/agents';
import type { AgentName } from '@ai/agents';
import type { AiTask } from '@ai/router';
import { readBoardJobs } from '@ai/jobs';
import { listAllNotes } from '@modules/knowledge/notes';
import { readFile } from '@utils/fs';
import { KNOWLEDGE_CATEGORIES } from '@ktypes/knowledge';

// Everything `kvasir stats` shows, computed from ~/.kvasir only (metrics, board.json, knowledge,
// profile.md). Plain data: the HTML is rendered from it in html.ts.

export const RADAR_AXES = ['commit', 'branch', 'fix', 'review', 'doc', 'task'] as const;
export type RadarAxis = (typeof RADAR_AXES)[number];

export interface StatsCards {
  calls: number;
  failures: number;
  approved: number;
  rejected: number;
  avgSeconds: number | null;
  outputTokens: number;
  cloudCalls: number;
  claudeRoundTrips: number;
  claudeTokens: number;
}

export interface DayBar {
  date: string;
  ok: number;
  failed: number;
}

export interface BoardCard {
  title: string;
  task: string;
  model: string;
  when: string;
  detail?: string;
}

export interface AgentStats {
  name: AgentName;
  label: string;
  role: string;
  tasks: AiTask[];
  calls: number;
  failures: number;
  approved: number;
  rejected: number;
  avgSeconds: number | null;
  outputTokens: number;
  mostUsed: string | null;
  bestModel: string | null;
  board: { queued: BoardCard[]; running: BoardCard[]; done: BoardCard[]; failed: BoardCard[] };
}

export interface StatsData {
  generatedAt: string;
  days: number;
  cards: StatsCards;
  radar: { axes: RadarAxis[]; week: number[]; monthWeeklyAvg: number[] };
  daily: DayBar[];
  models: ModelPerformance[];
  agents: AgentStats[];
  learned: { preferences: string[]; notesByCategory: Record<string, number>; recentErrors: string[]; totalNotes: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const BOARD_CARDS_PER_COLUMN = 8;
const BOARD_DAYS = 7;

function isCall(record: MetricsRecord): record is AiCallRecord {
  return record.type === 'call';
}

function isOutcome(record: MetricsRecord): record is AiOutcomeRecord {
  return record.type === 'outcome';
}

function label(call: { provider: string; model: string }): string {
  return call.provider === 'ollama' ? call.model.replace(/:latest$/, '') : `${call.provider}/${call.model}`;
}

function localDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Task activity is not an AI call: it comes from the dated lines the task notes get
// ("- 2026-10-18 · branch: ...").
function taskActivityDates(notes: Awaited<ReturnType<typeof listAllNotes>>): number[] {
  return notes
    .filter((note) => note.category === 'tasks')
    .flatMap((note) => [...note.body.matchAll(/^- (\d{4}-\d{2}-\d{2})\b/gm)].map((match) => Date.parse(`${match[1]}T12:00:00`)));
}

function radarCounts(executor: AiCallRecord[], taskDates: number[], since: number): number[] {
  return RADAR_AXES.map((axis) =>
    axis === 'task'
      ? taskDates.filter((time) => time >= since).length
      : executor.filter((call) => call.ok && call.task === axis && Date.parse(call.timestamp) >= since).length
  );
}

function cardFrom(call: AiCallRecord): BoardCard {
  return {
    title: call.title ?? `${call.task} em ${call.project}`,
    task: call.task,
    model: label(call),
    when: call.timestamp,
    detail: call.ok ? `${(call.durationMs / 1000).toFixed(1)}s` : call.error,
  };
}

function agentStats(name: AgentName, executor: AiCallRecord[], outcomes: AiOutcomeRecord[], models: ModelPerformance[]): AgentStats {
  const owned = (task: string): boolean => TASK_OWNER[task as AiTask] === name;
  const calls = executor.filter((call) => owned(call.task));
  const ok = calls.filter((call) => call.ok);
  const verdicts = outcomes.filter((outcome) => owned(outcome.task));
  const approved = verdicts.filter((outcome) => outcome.decision === 'approved').length;

  const byModel = new Map<string, { calls: number; approved: number; rejected: number }>();
  for (const row of models.filter((item) => owned(item.task))) {
    const key = label(row);
    const current = byModel.get(key) ?? { calls: 0, approved: 0, rejected: 0 };
    byModel.set(key, { calls: current.calls + row.calls, approved: current.approved + row.approved, rejected: current.rejected + row.rejected });
  }
  const entries = [...byModel.entries()];
  const mostUsed = entries.sort((a, b) => b[1].calls - a[1].calls)[0]?.[0] ?? null;
  // "rendeu melhor": smoothed approval, only among models the user judged at least twice
  const judged = entries.filter(([, value]) => value.approved + value.rejected >= 2);
  const bestModel =
    judged.sort((a, b) => (b[1].approved + 1) / (b[1].approved + b[1].rejected + 2) - (a[1].approved + 1) / (a[1].approved + a[1].rejected + 2))[0]?.[0] ?? null;

  const recentSince = Date.now() - BOARD_DAYS * DAY_MS;
  const recent = calls.filter((call) => Date.parse(call.timestamp) >= recentSince).reverse();
  const live = readBoardJobs().filter((job) => job.agent === name);

  return {
    name,
    label: AGENTS[name].label,
    role: AGENTS[name].role,
    tasks: tasksOf(name),
    calls: calls.length,
    failures: calls.length - ok.length,
    approved,
    rejected: verdicts.length - approved,
    avgSeconds: ok.length > 0 ? ok.reduce((sum, call) => sum + call.durationMs, 0) / ok.length / 1000 : null,
    outputTokens: ok.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
    mostUsed,
    bestModel,
    board: {
      queued: live.filter((job) => job.status === 'queued').map((job) => ({ title: job.title, task: job.task, model: '—', when: job.queuedAt })),
      running: live
        .filter((job) => job.status === 'running')
        .map((job) => ({ title: job.title, task: job.task, model: job.model ?? '—', when: job.startedAt ?? job.queuedAt })),
      done: recent.filter((call) => call.ok).slice(0, BOARD_CARDS_PER_COLUMN).map(cardFrom),
      failed: recent.filter((call) => !call.ok).slice(0, BOARD_CARDS_PER_COLUMN).map(cardFrom),
    },
  };
}

async function learnedPreferences(): Promise<string[]> {
  const profile = (await readFile(path.join(os.homedir(), '.kvasir', 'profile.md'))) ?? '';
  const section = profile.replace(/\r\n/g, '\n').match(/## Preferências aprendidas\n([\s\S]*?)(?=\n## |$)/);
  return (section?.[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

export async function collectStats(days: number): Promise<StatsData> {
  const records = await readMetrics(days);
  const calls = records.filter(isCall);
  const executor = calls.filter((call) => call.role === 'executor');
  const outcomes = records.filter(isOutcome);
  const summary = summarizeMetrics(records);
  const notes = await listAllNotes();
  const taskDates = taskActivityDates(notes);
  const now = Date.now();

  const ok = executor.filter((call) => call.ok);
  const claude = calls.filter((call) => call.provider === 'claude');

  const daily: DayBar[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = localDate(now - offset * DAY_MS);
    const ofDay = executor.filter((call) => localDate(Date.parse(call.timestamp)) === date);
    daily.push({ date, ok: ofDay.filter((call) => call.ok).length, failed: ofDay.filter((call) => !call.ok).length });
  }

  const week = radarCounts(executor, taskDates, now - 7 * DAY_MS);
  const month = radarCounts(executor, taskDates, now - 30 * DAY_MS);

  const notesByCategory: Record<string, number> = {};
  for (const category of KNOWLEDGE_CATEGORIES) notesByCategory[category] = notes.filter((note) => note.category === category).length;

  return {
    generatedAt: new Date().toISOString(),
    days,
    cards: {
      calls: executor.length,
      failures: executor.length - ok.length,
      approved: outcomes.filter((outcome) => outcome.decision === 'approved').length,
      rejected: outcomes.filter((outcome) => outcome.decision === 'rejected').length,
      avgSeconds: ok.length > 0 ? ok.reduce((sum, call) => sum + call.durationMs, 0) / ok.length / 1000 : null,
      outputTokens: ok.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
      cloudCalls: ok.filter((call) => call.provider !== 'ollama').length,
      claudeRoundTrips: claude.length,
      claudeTokens: Math.round(claude.reduce((sum, call) => sum + call.promptChars, 0) / 4),
    },
    radar: { axes: [...RADAR_AXES], week, monthWeeklyAvg: month.map((value) => Math.round((value / (30 / 7)) * 10) / 10) },
    daily,
    models: summary.models,
    agents: AGENT_NAMES.map((name) => agentStats(name, executor, outcomes, summary.models)),
    learned: {
      preferences: await learnedPreferences(),
      notesByCategory,
      recentErrors: notes
        .filter((note) => note.category === 'errors')
        .sort((a, b) => b.meta.updated.localeCompare(a.meta.updated))
        .slice(0, 6)
        .map((note) => note.meta.title),
      totalNotes: notes.length,
    },
  };
}
