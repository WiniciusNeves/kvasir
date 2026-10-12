import { Command } from 'commander';
import { runUndo } from '@modules/undo';
import { withErrorHandling } from '@utils/errors';

export function registerUndo(program: Command): void {
  program
    .command('undo')
    .description('Undo the last commit (git reset HEAD~1 --soft)')
    .action(withErrorHandling(runUndo));
}
