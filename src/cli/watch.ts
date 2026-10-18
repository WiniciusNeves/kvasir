import { Command } from 'commander';
import { runWatch } from '@modules/watch';
import { withErrorHandling } from '@utils/errors';

async function handleWatch(command: string[]): Promise<void> {
  await runWatch(command);
}

export function registerWatch(program: Command): void {
  program
    .command('watch')
    .description('Fix TypeScript errors on its own: watches the clipboard, or runs a command (kvasir watch -- npm run dev) and reads its output')
    .argument('[command...]', 'Command to run and watch (after --)')
    .allowUnknownOption()
    .action(withErrorHandling(handleWatch));
}
