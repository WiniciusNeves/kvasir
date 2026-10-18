import { Command } from 'commander';
import { runPr } from '@modules/pr';
import { withErrorHandling } from '@utils/errors';

export function registerPr(program: Command): void {
  program
    .command('pr')
    .description('Write the pull request title and description in Portuguese (copy or create with gh)')
    .action(withErrorHandling(runPr));
}
