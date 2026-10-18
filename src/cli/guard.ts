import { Command } from 'commander';
import { runGuard } from '@modules/guard';
import { withErrorHandling } from '@utils/errors';

export function registerGuard(program: Command): void {
  program
    .command('guard')
    .description('Check staged changes for secrets, forbidden files and personal data')
    .action(withErrorHandling(runGuard));
}
