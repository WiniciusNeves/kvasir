import os from 'os';
import path from 'path';
import { readFile, writeFile } from '@utils/fs';
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
  summary: string
): Promise<void> {
  const filePath = getFeedbackFile(category);
  const existing = (await readFile(filePath)) ?? `# ${category} feedback\n\n`;
  const timestamp = new Date().toISOString();
  const entry = `- [${timestamp}] ${decision.toUpperCase()}: ${summary}\n`;

  await writeFile(filePath, existing + entry);
}

export async function readFeedback(category: FeedbackCategory): Promise<string> {
  const filePath = getFeedbackFile(category);
  return (await readFile(filePath)) ?? '';
}
