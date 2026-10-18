import { Command } from 'commander';
import { runKeys, runKeysSet, runKeysRemove } from '@modules/keys';
import { withErrorHandling } from '@utils/errors';

export function registerKeys(program: Command): void {
  const keys = program
    .command('keys')
    .description('Show, save or remove the optional cloud AI keys (stored as user environment variables)')
    .action(withErrorHandling(runKeys));

  keys
    .command('status')
    .description('Show which cloud AI keys are configured (never prints them)')
    .action(withErrorHandling(runKeys));

  keys
    .command('set [provider]')
    .description('Paste a Gemini or Groq key: it is tested and saved as a user environment variable')
    .action(withErrorHandling(runKeysSet));

  keys
    .command('remove [provider]')
    .description('Remove a saved Gemini or Groq key')
    .action(withErrorHandling(runKeysRemove));
}
