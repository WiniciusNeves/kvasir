import { Command } from 'commander';
import { runIndex, runAsk } from '@modules/omnicontext';
import type { IndexOptions, AskOptions } from '@modules/omnicontext';
import { withErrorHandling } from '@utils/errors';

async function handleIndex(options: IndexOptions): Promise<void> {
  await runIndex(options);
}

async function handleAsk(words: string[], options: AskOptions): Promise<void> {
  await runAsk(words, options);
}

export function registerOmniContext(program: Command): void {
  program
    .command('index')
    .description('Index the project, its docs and the knowledge vault for kvasir ask (local embeddings)')
    .option('--no-knowledge', 'Do not index ~/.kvasir/knowledge')
    .option('--watch', 'Keep re-indexing the project while files change')
    .action(withErrorHandling(handleIndex));

  program
    .command('ask')
    .description('Ask about the code and your notes; answers cite file:line (local only)')
    .argument('<question...>', 'The question')
    .option('--all', 'Search every indexed folder, not only this project and the knowledge vault')
    .action(withErrorHandling(handleAsk));
}
