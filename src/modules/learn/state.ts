import os from 'os';
import path from 'path';
import { readJson, writeFile } from '@utils/fs';
import { readFeedback } from '@utils/feedback';
import type { FeedbackCategory } from '@ktypes/feedback';

// When `kvasir learn` last consolidated the feedback into profile.md, so the automatic offer can count
// what is new since then. State: ~/.kvasir/learn.json.

interface LearnState {
  lastRunAt?: string;
}

export const LEARN_CATEGORIES: FeedbackCategory[] = ['commits', 'branches', 'fixes', 'patterns'];

const ENTRY_TIMESTAMP = /^- \[([^\]]+)\]/;

function stateFile(): string {
  return path.join(os.homedir(), '.kvasir', 'learn.json');
}

export async function markLearned(): Promise<void> {
  const state: LearnState = { lastRunAt: new Date().toISOString() };
  await writeFile(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

// Feedback lines ("- [ISO] DECISION: …") of the categories learn reads, oldest first.
export async function readFeedbackEntries(): Promise<string[]> {
  const files = await Promise.all(LEARN_CATEGORIES.map((category) => readFeedback(category)));
  return files
    .flatMap((content) => content.split('\n'))
    .filter((line) => ENTRY_TIMESTAMP.test(line))
    .sort((a, b) => (a.match(ENTRY_TIMESTAMP)?.[1] ?? '').localeCompare(b.match(ENTRY_TIMESTAMP)?.[1] ?? ''));
}

// How many verdicts arrived since the last learn (all of them when learn never ran).
export async function countNewFeedback(): Promise<number> {
  const lastRunAt = (await readJson<LearnState>(stateFile()))?.lastRunAt ?? '';
  return (await readFeedbackEntries()).filter((line) => (line.match(ENTRY_TIMESTAMP)?.[1] ?? '') > lastRunAt).length;
}
