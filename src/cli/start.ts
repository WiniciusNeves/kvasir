import { Command } from 'commander';
import { runStart } from '@modules/start';
import { withErrorHandling } from '@utils/errors';

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the day: load context, active task, and branch')
    .action(withErrorHandling(runStart));
}
