import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';

// spawnSync only sets `error` when git can't start; a failed git command (hook rejected the commit,
// branch already exists, push rejected) only shows up in `status`.
function assertGitSuccess(result: SpawnSyncReturns<string>, action: string): void {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim();
    throw new Error(`git ${action} falhou${detail ? `: ${detail}` : ` (código ${result.status})`}`);
  }
}

export function getDiff(): string {
  const result = spawnSync('git', ['diff', '--cached'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return result.stdout ?? '';
}

export function getCurrentBranch(): string {
  const result = spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return result.stdout?.trim() ?? '';
}

export function createBranch(name: string): void {
  const result = spawnSync('git', ['checkout', '-b', name], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'checkout -b');
}

export function listLocalBranches(): string[] {
  const result = spawnSync('git', ['branch'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;

  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.replace('*', '').trim())
    .filter((line) => line.length > 0);
}

export function listAllBranches(): string {
  const result = spawnSync('git', ['branch', '-a'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return result.stdout ?? '';
}

export interface DeleteBranchResult {
  success: boolean;
  stderr: string;
}

export function deleteBranch(name: string, force: boolean = false): DeleteBranchResult {
  const flag = force ? '-D' : '-d';
  const result = spawnSync('git', ['branch', flag, name], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;

  return {
    success: result.status === 0,
    stderr: result.stderr ?? '',
  };
}

export function checkoutPreviousBranch(): void {
  const result = spawnSync('git', ['checkout', '-'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'checkout -');
}

export function commitWithMessage(message: string): void {
  const result = spawnSync('git', ['commit', '-m', message], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'commit');
}

export function stageAll(): void {
  const result = spawnSync('git', ['add', '-A'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  assertGitSuccess(result, 'add');
}

export interface PushOptions {
  forceWithLease?: boolean;
}

export function pushCurrentBranch(branch: string, options: PushOptions = {}): void {
  const args = ['push', 'origin', branch];
  if (options.forceWithLease) args.push('--force-with-lease');

  const result = spawnSync('git', args, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'push');
}

export function undoLastCommit(): void {
  const result = spawnSync('git', ['reset', 'HEAD~1', '--soft'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'reset');
}

export function getRecentLog(count: number = 10): string {
  const result = spawnSync('git', ['log', '--oneline', `-${count}`], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return result.stdout ?? '';
}

export function mergeBranchInto(targetBranch: string, sourceBranch: string): void {
  const checkoutResult = spawnSync('git', ['checkout', targetBranch], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(checkoutResult, 'checkout');

  const mergeResult = spawnSync('git', ['merge', sourceBranch], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(mergeResult, 'merge');
}

export function checkoutBranch(name: string): void {
  const result = spawnSync('git', ['checkout', name], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'checkout');
}

export function getDiffStat(): string {
  const result = spawnSync('git', ['diff', '--cached', '--stat'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return result.stdout ?? '';
}

export function getHeadShortHash(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return (result.stdout ?? '').trim();
}

// Every staged path, deleted ones included (what the commit is about).
export function getStagedPaths(): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf-8', cwd: process.cwd() });
  if (result.error) throw result.error;
  return (result.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

export interface CommitWithFiles {
  hash: string;
  // ISO date of the commit
  date: string;
  // the first line of the message (%s would join a title and a body not separated by a blank line)
  title: string;
  files: string[];
}

// The latest commits of `author` in this repository (no merges), each with the paths it touched.
export function getOwnCommitsWithFiles(author: string, limit: number): CommitWithFiles[] {
  const result = spawnSync('git', ['log', '--no-merges', `-n${limit}`, `--author=${author}`, '--name-only', '--format=%x1e%h%x1f%cI%x1f%B%x1d'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) return [];

  return (result.stdout ?? '')
    .split('\x1e')
    .filter((block) => block.trim())
    .map((block) => {
      const [header, fileList = ''] = block.split('\x1d');
      const [hash, date, message = ''] = header.split('\x1f');
      const title = message.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
      return { hash, date, title, files: fileList.split('\n').map((line) => line.trim()).filter(Boolean) };
    });
}

export function getStagedFiles(): string[] {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  if (result.error) throw result.error;
  return (result.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

// Removes files from the index only; the working copy is untouched.
export function unstageFiles(files: string[]): void {
  if (files.length === 0) return;
  const result = spawnSync('git', ['restore', '--staged', '--', ...files], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });

  assertGitSuccess(result, 'restore --staged');
}

function gitOutput(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, { encoding: 'utf-8', cwd: process.cwd() });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

export function refExists(ref: string): boolean {
  return gitOutput(['rev-parse', '--verify', '--quiet', ref]).ok;
}

// Commits on HEAD that are not on `base`, oldest first: "hash subject".
export function getCommitsSince(base: string): string[] {
  const { stdout } = gitOutput(['log', '--reverse', '--pretty=format:%h %s', `${base}..HEAD`]);
  return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

// Three-dot: changes of this branch since it forked from `base` (what the PR will show).
export function getDiffAgainst(base: string): string {
  return gitOutput(['diff', `${base}...HEAD`]).stdout;
}

export function getDiffStatAgainst(base: string): string {
  return gitOutput(['diff', '--stat', `${base}...HEAD`]).stdout;
}

export function getChangedFilesAgainst(base: string): string[] {
  return gitOutput(['diff', '--name-only', `${base}...HEAD`]).stdout.split('\n').filter(Boolean);
}

export function getUpstream(): string | null {
  const { ok, stdout } = gitOutput(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  return ok && stdout ? stdout : null;
}

export function pushWithUpstream(branch: string): void {
  const result = spawnSync('git', ['push', '-u', 'origin', branch], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  assertGitSuccess(result, 'push -u');
}

function gitIn(repo: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf-8' });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

export function isGitRepo(dir: string): boolean {
  return gitIn(dir, ['rev-parse', '--is-inside-work-tree']).ok;
}

export function getRepoRoot(dir: string): string | null {
  const { ok, stdout } = gitIn(dir, ['rev-parse', '--show-toplevel']);
  return ok && stdout ? stdout : null;
}

export function getGitConfigIn(repo: string, key: string): string {
  return gitIn(repo, ['config', '--get', key]).stdout;
}

export interface AuthoredCommit {
  hash: string;
  date: string;
  subject: string;
}

// Commits by `author` on any branch since `since` (anything git accepts: "2026-10-16", "yesterday").
export function getCommitsByAuthor(repo: string, author: string, since: string): AuthoredCommit[] {
  const { stdout } = gitIn(repo, [
    'log',
    '--all',
    '--no-merges',
    `--author=${author}`,
    `--since=${since}`,
    '--date=short',
    '--pretty=format:%h%x09%ad%x09%s',
  ]);

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, date, ...subject] = line.split('\t');
      return { hash, date, subject: subject.join('\t') };
    });
}

export function getLastTag(): string | null {
  const { ok, stdout } = gitOutput(['describe', '--tags', '--abbrev=0']);
  return ok && stdout ? stdout : null;
}

export interface FullCommit {
  hash: string;
  subject: string;
  body: string;
}

// Commits since `ref` (all commits when null), oldest first, with body (for BREAKING CHANGE footers).
export function getCommitsWithBody(ref: string | null): FullCommit[] {
  const range = ref ? [`${ref}..HEAD`] : ['HEAD'];
  const { stdout } = gitOutput(['log', '--reverse', '--no-merges', '--pretty=format:%h%x1f%s%x1f%b%x1e', ...range]);

  return stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject, body = ''] = record.split('\x1f');
      return { hash, subject, body: body.trim() };
    });
}

export function stageFiles(files: string[]): void {
  if (files.length === 0) return;
  const result = spawnSync('git', ['add', '--', ...files], { encoding: 'utf-8', cwd: process.cwd() });
  assertGitSuccess(result, 'add');
}

export function createAnnotatedTag(name: string, message: string): void {
  const result = spawnSync('git', ['tag', '-a', name, '-m', message], { encoding: 'utf-8', cwd: process.cwd() });
  assertGitSuccess(result, 'tag');
}

export function pushBranchWithTags(branch: string): void {
  const result = spawnSync('git', ['push', '--follow-tags', 'origin', branch], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  assertGitSuccess(result, 'push --follow-tags');
}

// Paths with any change (staged, unstaged or untracked), from `git status --porcelain`.
export function getChangedPaths(): string[] {
  const { stdout } = gitOutput(['status', '--porcelain', '--untracked-files=all']);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop() ?? '');
}

export interface BranchAge {
  name: string;
  // unix seconds of the last commit on the branch
  lastCommitAt: number;
}

// Local branches with the date of their last commit, oldest first.
export function getLocalBranchAges(): BranchAge[] {
  const result = spawnSync('git', ['for-each-ref', '--sort=committerdate', '--format=%(refname:short)|%(committerdate:unix)', 'refs/heads'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
  });
  if (result.error || result.status !== 0) return [];
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim().split('|'))
    .filter((parts) => parts.length === 2 && parts[0])
    .map(([name, time]) => ({ name, lastCommitAt: Number(time) }));
}

// Commits on `branch` that `base` does not have (0 = already merged).
export function countUnmergedCommits(branch: string, base: string): number {
  const result = spawnSync('git', ['rev-list', '--count', `${base}..${branch}`], { encoding: 'utf-8', cwd: process.cwd() });
  if (result.error || result.status !== 0) return -1;
  return Number((result.stdout ?? '').trim()) || 0;
}

// Last commit that touched any of `paths` (null when none did, or outside a repo).
export function lastCommitTouching(paths: string[]): string | null {
  const { ok, stdout } = gitOutput(['log', '-1', '--format=%H', '--', ...paths]);
  return ok && stdout ? stdout : null;
}

export interface ChangedFile {
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  path: string;
  // renamed: where it came from
  from?: string;
}

// Files changed since `ref`, committed or not (the working tree is compared with `ref`).
export function getChangedFilesSince(ref: string): ChangedFile[] {
  const { stdout } = gitOutput(['diff', '--name-status', '-M', ref]);
  const tracked = stdout
    .split('\n')
    .filter(Boolean)
    .map((line): ChangedFile => {
      const [code, first, second] = line.split('\t');
      if (code.startsWith('R')) return { status: 'renamed', path: second, from: first };
      return { status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified', path: first };
    });
  const untracked = gitOutput(['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean);
  return [...tracked, ...untracked.map((path): ChangedFile => ({ status: 'added', path }))];
}

// The diff of one file since `ref` (working tree included).
export function getFileDiffSince(ref: string, file: string): string {
  return gitOutput(['diff', ref, '--', file]).stdout;
}

// A file as it was at `ref` (null when it did not exist there).
export function getFileAtRef(ref: string, file: string): string | null {
  const { ok, stdout } = gitOutput(['show', `${ref}:${file.split('\\').join('/')}`]);
  return ok ? stdout : null;
}
