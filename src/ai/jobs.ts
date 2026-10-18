import os from 'os';
import path from 'path';
import fs from 'fs';
import { TASK_OWNER } from '@ai/agents';
import type { AiTask } from '@ai/router';

// Live state of the Agent Board: what each agent has queued ("a fazer") and is running ("em
// andamento") right now, in ~/.kvasir/metrics/board.json. Finished work ("feito" / "falhou") comes
// from calls.jsonl. Every job belongs to the owner agent of its task, and only that agent's
// executor call can pick it up (single owner).

export type JobStatus = 'queued' | 'running';

export interface BoardJob {
  id: string;
  pid: number;
  task: AiTask;
  agent: string;
  title: string;
  status: JobStatus;
  model?: string;
  queuedAt: string;
  startedAt?: string;
}

interface BoardState {
  jobs: BoardJob[];
}

// A crashed process leaves its jobs behind: drop jobs of dead processes or older than this.
const STALE_MINUTES = 30;

function boardFile(): string {
  return path.join(os.homedir(), '.kvasir', 'metrics', 'board.json');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readState(): BoardState {
  try {
    const state = JSON.parse(fs.readFileSync(boardFile(), 'utf-8')) as BoardState;
    const limit = Date.now() - STALE_MINUTES * 60 * 1000;
    return { jobs: (state.jobs ?? []).filter((job) => isAlive(job.pid) && Date.parse(job.startedAt ?? job.queuedAt) >= limit) };
  } catch {
    return { jobs: [] };
  }
}

// The board must never break a command: write errors are ignored.
function writeState(state: BoardState): void {
  try {
    fs.mkdirSync(path.dirname(boardFile()), { recursive: true });
    fs.writeFileSync(boardFile(), JSON.stringify(state, null, 2));
  } catch {
    // ignore
  }
}

function update(mutate: (jobs: BoardJob[]) => BoardJob[]): void {
  const state = readState();
  writeState({ jobs: mutate(state.jobs) });
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readBoardJobs(): BoardJob[] {
  return readState().jobs;
}

// A batch announces its work up front (doc --code files, fix expansion): it shows as "a fazer".
export function queueJobs(task: AiTask, titles: string[]): void {
  const now = new Date().toISOString();
  const jobs = titles.map((title): BoardJob => ({ id: newId(), pid: process.pid, task, agent: TASK_OWNER[task], title, status: 'queued', queuedAt: now }));
  update((current) => [...current, ...jobs]);
}

// Called by the router when the owner agent starts working: takes this process's oldest queued job
// of the task, or creates one.
export function startJob(task: AiTask, model: string): BoardJob {
  const now = new Date().toISOString();
  const state = readState();
  const queued = state.jobs.find((job) => job.pid === process.pid && job.task === task && job.status === 'queued');
  const started: BoardJob = queued
    ? { ...queued, status: 'running', model, startedAt: now }
    : {
        id: newId(),
        pid: process.pid,
        task,
        agent: TASK_OWNER[task],
        title: `${task} em ${path.basename(process.cwd())}`,
        status: 'running',
        model,
        queuedAt: now,
        startedAt: now,
      };
  writeState({ jobs: [...state.jobs.filter((job) => job.id !== started.id), started] });
  return started;
}

// The same job moves to the next model of the chain after a failure.
export function switchJobModel(job: BoardJob, model: string): void {
  update((current) => current.map((item) => (item.id === job.id ? { ...item, model } : item)));
}

export function finishJob(job: BoardJob): void {
  update((current) => current.filter((item) => item.id !== job.id));
}

// Leftovers of a batch that stopped early (user cancelled, error).
export function clearQueuedJobs(task: AiTask): void {
  update((current) => current.filter((job) => !(job.pid === process.pid && job.task === task && job.status === 'queued')));
}
