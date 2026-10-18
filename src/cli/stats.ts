import { Command } from 'commander';
import { runStats, runBoard } from '@modules/stats';
import type { StatsOptions } from '@modules/stats';
import { withErrorHandling } from '@utils/errors';

async function handleStats(options: StatsOptions): Promise<void> {
  await runStats(options);
}

async function handleBoard(options: StatsOptions): Promise<void> {
  await runBoard(options);
}

export function registerStats(program: Command): void {
  program
    .command('stats')
    .description('Usage stats and the Agent Board as an offline HTML page (~/.kvasir/reports/stats.html)')
    .option('--days <n>', 'Period in days (default 30)')
    .option('--watch', 'Keep the page updating live (Agent Board)')
    .option('--no-open', 'Only generate the HTML, do not open the browser')
    .action(withErrorHandling(handleStats));

  program
    .command('board')
    .description('Agent Board live: what each AI agent has queued, is running, finished or failed')
    .option('--days <n>', 'Period in days (default 30)')
    .option('--no-open', 'Only generate the HTML, do not open the browser')
    .action(withErrorHandling(handleBoard));
}
