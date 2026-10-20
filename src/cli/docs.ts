import { Command } from 'commander';
import { runDocsUpdate } from '@modules/docs';
import type { DocsUpdateOptions } from '@modules/docs';
import { withErrorHandling } from '@utils/errors';

async function handleDocsUpdate(options: DocsUpdateOptions): Promise<void> {
  await runDocsUpdate(options);
}

export function registerDocs(program: Command): void {
  const docs = program.command('docs').description('Keep the project documentation in sync with the code');

  docs
    .command('update')
    .description('Propose README/docs edits for what changed in the code since the docs were last committed')
    .option('--since <ref>', 'Compare with this git ref instead of the last commit that touched the docs')
    .action(withErrorHandling(handleDocsUpdate));
}
