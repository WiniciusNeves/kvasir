import { Command } from 'commander';
import { runInit } from '@modules/init';
import { withErrorHandling } from '@utils/errors';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Detect project stack, apply persona, and generate context files')
    .action(withErrorHandling(runInit));
}
