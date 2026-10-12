import { Command } from 'commander';
import { runTask } from '@modules/task';
import { withErrorHandling } from '@utils/errors';

export function registerTask(program: Command): void {
  program
    .command('task')
    .description('Fetch tasks and link one to the current project')
    .action(withErrorHandling(runTask));
}
