import { Command } from 'commander';
import { runFix } from '@modules/fix';
import type { FixOptions } from '@modules/fix';
import { withErrorHandling } from '@utils/errors';

async function handleFix(options: FixOptions): Promise<void> {
  await runFix(options);
}

export function registerFix(program: Command): void {
  program
    .command('fix')
    .description('Fix the pasted TypeScript error, then offer to fix the same error elsewhere')
    .option('--undo', 'Restore the files changed by the last kvasir fix')
    .action(withErrorHandling(handleFix));
}
