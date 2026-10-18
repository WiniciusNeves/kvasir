import { Command } from 'commander';
import { runRelease } from '@modules/release';
import { withErrorHandling } from '@utils/errors';

export function registerRelease(program: Command): void {
  program
    .command('release')
    .description('Bump the SemVer version from Conventional Commits, update CHANGELOG.md, commit and tag')
    .action(withErrorHandling(runRelease));
}
