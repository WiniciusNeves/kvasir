import { Command } from 'commander';
import { runPush } from '@modules/push';
import { withErrorHandling } from '@utils/errors';

export function registerPush(program: Command): void {
  program
    .command('push')
    .description('Push the current branch, optionally with --force-with-lease')
    .action(withErrorHandling(runPush));
}
