import { spawnSync } from 'child_process';
import type { SpawnSyncReturns } from 'child_process';

const IS_WINDOWS = process.platform === 'win32';
const NEEDS_QUOTES = /[\s"&|<>^()%!]/;

export interface RunCommandOptions {
  inherit?: boolean;
  timeoutMs?: number;
}

function quoteWindowsArg(arg: string): string {
  if (arg.length > 0 && !NEEDS_QUOTES.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// On Windows, npm/npx/code are .cmd scripts: since Node 18.20/20.12 spawning them without a shell
// throws EINVAL. Instead of `shell: true`, call cmd.exe explicitly with quoted args (the same thing
// Node does internally, but without string-concatenating unescaped args).
export function runCommand(bin: string, args: string[], options: RunCommandOptions = {}): SpawnSyncReturns<string> {
  const { inherit = false, timeoutMs } = options;
  const common = {
    encoding: 'utf-8' as const,
    cwd: process.cwd(),
    stdio: inherit ? ('inherit' as const) : ('pipe' as const),
    timeout: timeoutMs,
  };

  if (!IS_WINDOWS) return spawnSync(bin, args, common);

  const commandLine = [bin, ...args].map(quoteWindowsArg).join(' ');
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
    ...common,
    windowsVerbatimArguments: true,
  });
}

export function commandSucceeded(result: SpawnSyncReturns<string>): boolean {
  return !result.error && result.status === 0;
}
