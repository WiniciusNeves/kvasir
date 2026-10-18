import os from 'os';
import path from 'path';
import { appendLine, readFile } from '@utils/fs';

// Every AI call (and the user's verdict on its result) goes to ~/.kvasir/metrics/calls.jsonl.
// This is the raw data for the Agent Board, `kvasir stats`, performance-based routing and learning.

export type AiProvider = 'ollama' | 'gemini' | 'groq' | 'claude';
export type AiRole = 'executor' | 'orchestrator' | 'validator' | 'direct';
export type OutcomeDecision = 'approved' | 'rejected';

export interface AiCallRecord {
  type: 'call';
  id: string;
  timestamp: string;
  project: string;
  task: string;
  // owner agent of the task (ai/agents.ts); absent in records from before the agent team
  agent?: string;
  // what the job was about (Agent Board): "src/cart.ts", "commit em kvasir"
  title?: string;
  provider: AiProvider;
  model: string;
  role: AiRole;
  ok: boolean;
  error?: string;
  durationMs: number;
  promptChars: number;
  outputChars: number;
  promptTokens?: number;
  outputTokens?: number;
}

export interface AiOutcomeRecord {
  type: 'outcome';
  callId: string;
  timestamp: string;
  task: string;
  model: string;
  decision: OutcomeDecision;
}

export type MetricsRecord = AiCallRecord | AiOutcomeRecord;
export type NewAiCall = Omit<AiCallRecord, 'type' | 'id' | 'timestamp' | 'project'>;

// The last successful executor call per task in this process: the one the user's verdict refers to.
const lastExecutorCall = new Map<string, AiCallRecord>();

function getMetricsFile(): string {
  return path.join(os.homedir(), '.kvasir', 'metrics', 'calls.jsonl');
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Metrics must never break a command: write errors are swallowed.
async function append(record: MetricsRecord): Promise<void> {
  try {
    await appendLine(getMetricsFile(), JSON.stringify(record));
  } catch {
    // ignore
  }
}

export async function recordAiCall(call: NewAiCall): Promise<AiCallRecord> {
  const record: AiCallRecord = {
    type: 'call',
    id: newId(),
    timestamp: new Date().toISOString(),
    project: path.basename(process.cwd()),
    ...call,
  };
  if (record.ok && record.role === 'executor') lastExecutorCall.set(record.task, record);
  await append(record);
  return record;
}

export async function recordOutcome(task: string, decision: OutcomeDecision): Promise<void> {
  const call = lastExecutorCall.get(task);
  if (!call) return;
  lastExecutorCall.delete(task);
  await append({ type: 'outcome', callId: call.id, timestamp: new Date().toISOString(), task, model: call.model, decision });
}

// The executor call a verdict would go to, without consuming it (kvasir watch stores it with the backup).
export function peekLastExecutorCall(task: string): AiCallRecord | undefined {
  return lastExecutorCall.get(task);
}

// A verdict that arrives later, in another process: undoing an automatic fix rejects the call that made it.
export async function recordOutcomeForCall(call: { id: string; task: string; model: string }, decision: OutcomeDecision): Promise<void> {
  await append({ type: 'outcome', callId: call.id, timestamp: new Date().toISOString(), task: call.task, model: call.model, decision });
}

export async function readMetrics(sinceDays: number): Promise<MetricsRecord[]> {
  const content = await readFile(getMetricsFile());
  if (!content) return [];

  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const records = content
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as MetricsRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is MetricsRecord => record !== null && Date.parse(record.timestamp) >= since);

  // Only the last verdict on a call counts: a fix validated (approved) and later undone by the user
  // (rejected) is a rejection, not one of each.
  const lastVerdict = new Map<string, MetricsRecord>();
  for (const record of records) if (record.type === 'outcome') lastVerdict.set(record.callId, record);
  return records.filter((record) => record.type !== 'outcome' || lastVerdict.get(record.callId) === record);
}

export interface ModelPerformance {
  task: string;
  provider: AiProvider;
  model: string;
  calls: number;
  failures: number;
  avgSeconds: number;
  avgOutputTokens: number | null;
  approved: number;
  rejected: number;
}

export interface ClaudeUsage {
  roundTrips: number;
  promptChars: number;
}

export interface MetricsSummary {
  models: ModelPerformance[];
  claude: ClaudeUsage;
}

export function summarizeMetrics(records: MetricsRecord[]): MetricsSummary {
  const calls = records.filter((record): record is AiCallRecord => record.type === 'call');
  const outcomes = records.filter((record): record is AiOutcomeRecord => record.type === 'outcome');
  const byKey = new Map<string, AiCallRecord[]>();

  // Every executor provider (Ollama and cloud); Claude via clipboard is reported apart.
  for (const call of calls.filter((record) => record.provider !== 'claude')) {
    const key = `${call.task}\u0000${call.provider}\u0000${call.model}`;
    byKey.set(key, [...(byKey.get(key) ?? []), call]);
  }

  const models = [...byKey.entries()].map(([key, group]): ModelPerformance => {
    const [task, , model] = key.split('\u0000');
    const provider = group[0].provider;
    const ok = group.filter((call) => call.ok);
    const withTokens = ok.filter((call) => call.outputTokens !== undefined);
    const verdicts = outcomes.filter((outcome) => outcome.task === task && outcome.model === model);

    return {
      task,
      provider,
      model,
      calls: group.length,
      failures: group.length - ok.length,
      avgSeconds: ok.length > 0 ? ok.reduce((sum, call) => sum + call.durationMs, 0) / ok.length / 1000 : 0,
      avgOutputTokens:
        withTokens.length > 0 ? withTokens.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0) / withTokens.length : null,
      approved: verdicts.filter((outcome) => outcome.decision === 'approved').length,
      rejected: verdicts.filter((outcome) => outcome.decision === 'rejected').length,
    };
  });

  const claudeCalls = calls.filter((call) => call.provider === 'claude');
  return {
    models: models.sort((a, b) => a.task.localeCompare(b.task) || b.calls - a.calls),
    claude: { roundTrips: claudeCalls.length, promptChars: claudeCalls.reduce((sum, call) => sum + call.promptChars, 0) },
  };
}
