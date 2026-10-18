import { Command } from 'commander';
import { runProactive } from '@modules/proactive/settings';
import { withErrorHandling } from '@utils/errors';

export function registerProactive(program: Command): void {
  program
    .command('proactive')
    .description('Show and adjust proactive suggestions (ask, automatic or off), learned from your answers')
    .action(withErrorHandling(runProactive));
}
