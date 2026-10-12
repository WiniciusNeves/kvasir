import { Command } from 'commander';
import { runFormat } from '@modules/format';
import { withErrorHandling } from '@utils/errors';

export function registerFormat(program: Command): void {
  program
    .command('format')
    .description('Format code before committing')
    .action(withErrorHandling(runFormat));
}
