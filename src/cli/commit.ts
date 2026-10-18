import { Command } from 'commander';
import { runCommit } from '@modules/commit';
import type { CommitOptions } from '@modules/commit';
import { withErrorHandling } from '@utils/errors';

async function handleCommit(options: CommitOptions): Promise<void> {
  await runCommit(options);
}

export function registerCommit(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from git diff (runs kvasir guard first)')
    .option('--no-guard', 'Skip the secret/sensitive data check')
    .action(withErrorHandling(handleCommit));
}
