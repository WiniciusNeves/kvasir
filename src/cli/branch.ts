import { Command } from 'commander';
import { runBranch, runDeleteBranch, runListBranches } from '@modules/branch';
import { withErrorHandling } from '@utils/errors';

interface BranchCliOptions {
  delete?: boolean;
  list?: boolean;
}

async function handleBranch(options: BranchCliOptions): Promise<void> {
  if (options.delete) {
    await runDeleteBranch();
    return;
  }

  if (options.list) {
    await runListBranches();
    return;
  }

  await runBranch();
}

export function registerBranch(program: Command): void {
  program
    .command('branch')
    .description('Generate a branch name from a task and create it')
    .option('-d, --delete', 'Delete a local branch')
    .option('-l, --list', 'List all local and remote branches')
    .action(withErrorHandling(handleBranch));
}
