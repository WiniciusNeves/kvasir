import { Command } from 'commander';
import { runDoc } from '@modules/doc';
import { runDocCode } from '@modules/doc/code';
import { withErrorHandling } from '@utils/errors';

interface DocCliOptions {
  code?: boolean;
  all?: boolean;
  force?: boolean;
}

async function handleDoc(target: string | undefined, options: DocCliOptions): Promise<void> {
  if (options.code) {
    await runDocCode(target, { all: options.all, force: options.force });
    return;
  }

  if (!target) {
    throw new Error('Missing library name. Usage: kvasir doc <library>');
  }

  await runDoc(target);
}

export function registerDoc(program: Command): void {
  program
    .command('doc [target]')
    .description('Fetch documentation for an npm library, or use --code to document project source files')
    .option('--code', 'Document project source code instead of an npm library')
    .option('--all', 'Document the entire project (use with --code)')
    .option('--force', 'Regenerate docs even if they already exist (use with --code --all)')
    .action(withErrorHandling(handleDoc));
}
