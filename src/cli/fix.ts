import { Command } from 'commander';
import { runFix } from '@modules/fix';
import { withErrorHandling } from '@utils/errors';

export function registerFix(program: Command): void {
  program
    .command('fix')
    .description('Analyze an error and propose a fix')
    .action(withErrorHandling(runFix));
}
