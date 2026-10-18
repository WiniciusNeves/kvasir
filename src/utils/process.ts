import { spawn, spawnSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
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

// True when the executable is on the PATH (or the given path exists). Asks the OS (`where` / `which`)
// instead of running the tool: through `cmd /c` an unknown command exits with 1 like any failure,
// and the "not recognized" message is localized (with broken accents on a Portuguese Windows).
export function commandExists(bin: string): boolean {
  if (path.isAbsolute(bin) || /[\\/]/.test(bin)) {
    return ['', '.exe', '.cmd', '.bat'].some((extension) => fs.existsSync(`${bin}${extension}`));
  }

  const result = spawnSync(IS_WINDOWS ? 'where' : 'which', [bin], { encoding: 'utf-8', stdio: 'pipe' });
  return !result.error && result.status === 0;
}

// Opens a local file (an HTML report) with the system's default app. No shell: explorer/open/xdg-open
// receive the path as a single argument. explorer.exe exits with 1 even when it worked, so the
// result is not checked on Windows.
export function openInDefaultApp(filePath: string): boolean {
  const bin = IS_WINDOWS ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const result = spawnSync(bin, [filePath], { stdio: 'ignore', timeout: 15_000 });
  return !result.error && (IS_WINDOWS || result.status === 0);
}

// Long-running command with piped output (kvasir watch -- npm run dev). Same rules as runCommand:
// no shell; on Windows cmd.exe /d /s /c with escaped args so .cmd scripts work.
export function spawnCommand(bin: string, args: string[]): ChildProcess {
  const options = { cwd: process.cwd(), stdio: ['inherit', 'pipe', 'pipe'] as ('inherit' | 'pipe')[], env: { ...process.env, FORCE_COLOR: '1' } };
  if (!IS_WINDOWS) return spawn(bin, args, options);

  const commandLine = [bin, ...args].map(quoteWindowsArg).join(' ');
  return spawn('cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], { ...options, windowsVerbatimArguments: true });
}
