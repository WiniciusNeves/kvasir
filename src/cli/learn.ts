import { Command } from 'commander';
import { runLearn } from '@modules/learn';
import { withErrorHandling } from '@utils/errors';

export function registerLearn(program: Command): void {
  program
    .command('learn')
    .description('Consolidate recorded feedback and update the developer profile')
    .action(withErrorHandling(runLearn));
}
