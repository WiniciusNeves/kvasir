import os from 'os';
import path from 'path';
import { readJson, writeFile } from '@utils/fs';
import { readFeedback } from '@utils/feedback';
import type { FeedbackCategory } from '@ktypes/feedback';

// When `kvasir learn` last consolidated the feedback of each project into profiles/<project>.md, so the
// automatic offer counts only what is new. State: ~/.kvasir/learn.json.

interface LearnState {
  // before profiles were per project: one run covered every project
  lastRunAt?: string;
  projects?: Record<string, string>;
}

export interface FeedbackEntry {
  timestamp: string;
  category: FeedbackCategory;
  approved: boolean;
  // undefined for verdicts recorded before feedback carried the project
  project?: string;
  summary: string;
  reason: string;
}

export const LEARN_CATEGORIES: FeedbackCategory[] = ['commits', 'branches', 'fixes', 'patterns'];

// "- [ISO] DECISION [project]: summary (motivo: …)", written by recordFeedback (older lines have no project)
const ENTRY = /^- \[([^\]]+)\] ([A-Z]+)(?: \[([^\]]+)\])?: (.*)$/;
const REASON = /\s*\(motivo: (.*)\)$/;

function stateFile(): string {
  return path.join(os.homedir(), '.kvasir', 'learn.json');
}

async function readState(): Promise<LearnState> {
  return (await readJson<LearnState>(stateFile())) ?? {};
}

export async function markLearned(project: string): Promise<void> {
  const state = await readState();
  const next: LearnState = { ...state, projects: { ...state.projects, [project]: new Date().toISOString() } };
  await writeFile(stateFile(), `${JSON.stringify(next, null, 2)}\n`);
}

function parseEntry(category: FeedbackCategory, line: string): FeedbackEntry[] {
  const match = line.match(ENTRY);
  if (!match) return [];
  const text = match[4].trim();
  const reason = text.match(REASON)?.[1].trim() ?? '';
  return [{ timestamp: match[1], category, approved: match[2] === 'APPROVED', project: match[3], summary: text.replace(REASON, ''), reason }];
}

// Feedback entries of the categories learn reads, oldest first.
export async function readFeedbackEntries(): Promise<FeedbackEntry[]> {
  const files = await Promise.all(LEARN_CATEGORIES.map(async (category) => ({ category, content: await readFeedback(category) })));
  return files
    .flatMap(({ category, content }) => content.split('\n').flatMap((line) => parseEntry(category, line)))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// How many verdicts of this project arrived since its last learn (all of them when it never ran).
export async function countNewFeedback(project: string): Promise<number> {
  const state = await readState();
  const since = state.projects?.[project] ?? state.lastRunAt ?? '';
  return (await readFeedbackEntries()).filter((entry) => entry.project === project && entry.timestamp > since).length;
}
