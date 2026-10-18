import { Command } from 'commander';
import { runDaily } from '@modules/daily';
import type { DailyOptions } from '@modules/daily';
import { withErrorHandling } from '@utils/errors';

async function handleDaily(options: DailyOptions): Promise<void> {
  await runDaily(options);
}

export function registerDaily(program: Command): void {
  program
    .command('daily')
    .description('Summarize your commits for the daily stand-up (yesterday / today / blockers)')
    .option('--since <date>', 'Start date for the commits (default: yesterday, or Friday on Mondays)')
    .option('--repos <folder>', 'Folder with the repositories to read (saved for next time)')
    .action(withErrorHandling(handleDaily));
}
