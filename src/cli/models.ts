import { Command } from 'commander';
import { runModels } from '@modules/models';
import { withErrorHandling } from '@utils/errors';

export function registerModels(program: Command): void {
  program
    .command('models')
    .description('Show installed Ollama models and the active model per task')
    .action(withErrorHandling(runModels));
}
