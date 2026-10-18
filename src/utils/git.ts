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
