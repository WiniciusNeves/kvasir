import type { FullCommit } from '@utils/git';

// Deterministic by spec: the next version comes from the Conventional Commits, no AI.

export type Bump = 'major' | 'minor' | 'patch';

export interface ParsedCommit {
  hash: string;
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
  // true when the subject is not a Conventional Commit
  unconventional: boolean;
}

const HEADER = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

export function parseCommit(commit: FullCommit): ParsedCommit {
  const match = commit.subject.match(HEADER);
  const breakingFooter = /^BREAKING[ -]CHANGE:/m.test(commit.body);

  if (!match) {
    return { hash: commit.hash, type: 'other', scope: null, description: commit.subject, breaking: breakingFooter, unconventional: true };
  }

  const [, type, scope, bang, description] = match;
  return {
    hash: commit.hash,
    type: type.toLowerCase(),
    scope: scope || null,
    description,
    breaking: Boolean(bang) || breakingFooter,
    unconventional: false,
  };
}

// BREAKING CHANGE or "!" → major · feat → minor · fix/perf → patch · anything else → nothing.
export function detectBump(commits: ParsedCommit[]): Bump | null {
  if (commits.some((commit) => commit.breaking)) return 'major';
  if (commits.some((commit) => commit.type === 'feat')) return 'minor';
  if (commits.some((commit) => commit.type === 'fix' || commit.type === 'perf')) return 'patch';
  return null;
}

export function parseVersion(version: string): [number, number, number] {
  const match = version.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Versão inválida: "${version}" (esperado X.Y.Z).`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function bumpVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = parseVersion(current);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version.trim());
}
