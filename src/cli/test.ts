import { Command } from 'commander';
import { runTest } from '@modules/test';
import { withErrorHandling } from '@utils/errors';

async function handleTest(file: string | undefined): Promise<void> {
  await runTest(file);
}

export function registerTest(program: Command): void {
  program
    .command('test [file]')
    .description('Generate tests for changed files (or the given file), run them and fix until they pass')
    .action(withErrorHandling(handleTest));
}
