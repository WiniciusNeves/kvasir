import { Command } from 'commander';
import { runModels } from '@modules/models';
import type { ModelsOptions } from '@modules/models';
import { withErrorHandling } from '@utils/errors';

async function handleModels(options: ModelsOptions): Promise<void> {
  await runModels(options);
}

export function registerModels(program: Command): void {
  program
    .command('models')
    .description('Show local and cloud models, who answers each task and real performance')
    .option('--cloud <on|off>', 'Allow or forbid sending prompts to cloud providers (Gemini, Groq)')
    .action(withErrorHandling(handleModels));
}
