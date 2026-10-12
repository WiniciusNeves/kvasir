import { Command } from 'commander';
import { runReview } from '@modules/review';
import { withErrorHandling } from '@utils/errors';

export function registerReview(program: Command): void {
  program
    .command('review')
    .description('Review staged code changes before committing')
    .action(withErrorHandling(runReview));
}
