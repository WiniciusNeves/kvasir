import { Command } from 'commander';
import { runCommit } from '@modules/commit';
import { withErrorHandling } from '@utils/errors';

export function registerCommit(program: Command): void {
  program
    .command('commit')
    .description('Generate a commit message from git diff')
    .action(withErrorHandling(runCommit));
}
