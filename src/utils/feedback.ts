import os from 'os';
import path from 'path';
import { readFile, writeFile } from '@utils/fs';
import { currentProject } from '@utils/project';
import type { FeedbackCategory, FeedbackDecision } from '@ktypes/feedback';

function getFeedbackDir(): string {
  return path.join(os.homedir(), '.kvasir', 'feedback');
}

function getFeedbackFile(category: FeedbackCategory): string {
  return path.join(getFeedbackDir(), `${category}.md`);
}

export async function recordFeedback(
  category: FeedbackCategory,
  decision: FeedbackDecision,
  summary: string,
  reason = ''
): Promise<void> {
  const filePath = getFeedbackFile(category);
  const existing = (await readFile(filePath)) ?? `# ${category} feedback\n\n`;
  const timestamp = new Date().toISOString();
  const why = reason.trim() ? ` (motivo: ${reason.trim().replace(/\s+/g, ' ')})` : '';
  // the project the verdict was given in: `learn` keeps one project's taste out of the others
  const entry = `- [${timestamp}] ${decision.toUpperCase()} [${currentProject()}]: ${summary}${why}\n`;

  await writeFile(filePath, existing + entry);
}

export async function readFeedback(category: FeedbackCategory): Promise<string> {
  const filePath = getFeedbackFile(category);
  return (await readFile(filePath)) ?? '';
}
