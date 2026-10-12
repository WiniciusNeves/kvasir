import { getRecentLog } from '@utils/git';

const DEFAULT_LOG_COUNT = 10;

interface LogEntry {
  hash: string;
  subject: string;
}

function parseLogEntries(rawLog: string): LogEntry[] {
  return rawLog
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const spaceIndex = line.indexOf(' ');
      if (spaceIndex === -1) return { hash: line, subject: '' };
      return { hash: line.slice(0, spaceIndex), subject: line.slice(spaceIndex + 1).trim() };
    });
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function formatLogTable(entries: LogEntry[]): string {
  if (entries.length === 0) return 'Nenhum commit encontrado.';

  const title = 'Ultimos commits';
  const hashWidth = Math.max(...entries.map((entry) => entry.hash.length));
  const rawSubjectWidth = Math.max(...entries.map((entry) => entry.subject.length));
  const minInnerWidth = title.length + 2;
  const subjectWidth = Math.max(rawSubjectWidth, minInnerWidth - hashWidth - 5);

  const totalInnerWidth = hashWidth + subjectWidth + 5;

  const lines: string[] = [];
  lines.push('+' + '-'.repeat(totalInnerWidth) + '+');
  lines.push('| ' + padRight(title, totalInnerWidth - 1) + '|');
  lines.push('+' + '-'.repeat(hashWidth + 2) + '+' + '-'.repeat(subjectWidth + 2) + '+');

  for (const entry of entries) {
    lines.push(`| ${padRight(entry.hash, hashWidth)} | ${padRight(entry.subject, subjectWidth)} |`);
  }

  lines.push('+' + '-'.repeat(hashWidth + 2) + '+' + '-'.repeat(subjectWidth + 2) + '+');

  return lines.join('\n');
}

export async function runLog(): Promise<void> {
  const rawLog = getRecentLog(DEFAULT_LOG_COUNT);
  const entries = parseLogEntries(rawLog);

  console.log('');
  console.log(formatLogTable(entries));
}
