import { Command } from 'commander';
import { runDeploy } from '@modules/deploy';
import { withErrorHandling } from '@utils/errors';

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Check what this project needs to ship (Expo/EAS or web/Vercel) and publish it with approval')
    .action(withErrorHandling(runDeploy));
}
