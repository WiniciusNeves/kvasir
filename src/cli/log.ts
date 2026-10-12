import { Command } from 'commander';
import { runLog } from '@modules/log';
import { withErrorHandling } from '@utils/errors';

export function registerLog(program: Command): void {
  program
    .command('log')
    .description('Show a formatted view of recent commits')
    .action(withErrorHandling(runLog));
}
