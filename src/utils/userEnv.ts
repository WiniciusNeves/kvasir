import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Persistent USER environment variables (API keys live here, never in ~/.kvasir or the repo).
// Windows: HKCU\Environment via `setx` (new terminals see it). macOS/Linux: a marked block of
// `export` lines in the shell profile. The saved value is also read back directly, so Kvasir sees a
// key saved a minute ago even in a terminal that was opened before.

const IS_WINDOWS = process.platform === 'win32';
const BLOCK_START = '# >>> kvasir keys >>>';
const BLOCK_END = '# <<< kvasir keys <<<';
const SAFE_VALUE = /^[A-Za-z0-9_\-.]+$/;

const cache = new Map<string, string | null>();

function shellProfilePath(): string {
  const shell = path.basename(process.env.SHELL ?? '');
  const file = shell === 'zsh' ? '.zshrc' : shell === 'bash' ? '.bashrc' : '.profile';
  return path.join(os.homedir(), file);
}

// Where the value is stored, for messages ("nas variáveis de ambiente do usuário do Windows").
export function userEnvLocation(): string {
  return IS_WINDOWS ? 'variáveis de ambiente do seu usuário do Windows' : shellProfilePath().replace(os.homedir(), '~');
}

function readWindowsValue(name: string): string | null {
  const result = spawnSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf-8', stdio: 'pipe' });
  if (result.error || result.status !== 0) return null;
  const line = (result.stdout ?? '').split(/\r?\n/).find((item) => item.trim().startsWith(`${name} `));
  const match = line?.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/);
  return match ? match[1].trim() || null : null;
}

function readProfileBlock(): string[] {
  const file = shellProfilePath();
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf-8');
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);
  if (start === -1 || end === -1 || end < start) return [];
  return content
    .slice(start + BLOCK_START.length, end)
    .split(/\r?\n/)
    .filter((line) => line.trim());
}

function writeProfileBlock(lines: string[]): void {
  const file = shellProfilePath();
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const block = lines.length > 0 ? `${BLOCK_START}\n${lines.join('\n')}\n${BLOCK_END}\n` : '';
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  let next: string;
  if (start !== -1 && end > start) {
    next = content.slice(0, start) + block + content.slice(end + BLOCK_END.length).replace(/^\r?\n/, '');
  } else {
    next = block ? `${content}${content && !content.endsWith('\n') ? '\n' : ''}${block}` : content;
  }
  fs.writeFileSync(file, next, { mode: 0o600 });
}

function readProfileValue(name: string): string | null {
  const line = readProfileBlock().find((item) => item.startsWith(`export ${name}=`));
  return line ? line.slice(`export ${name}=`.length).replace(/^'|'$/g, '') || null : null;
}

// The saved value (not process.env): what `kvasir keys` wrote, even before the terminal is reopened.
export function readSavedUserEnv(name: string): string | null {
  if (!cache.has(name)) cache.set(name, IS_WINDOWS ? readWindowsValue(name) : readProfileValue(name));
  return cache.get(name) ?? null;
}

export function writeUserEnv(name: string, value: string): void {
  if (!SAFE_VALUE.test(value)) throw new Error('Valor com caracteres inesperados: confira se colou só a chave.');

  if (IS_WINDOWS) {
    const result = spawnSync('setx', [name, value], { encoding: 'utf-8', stdio: 'pipe' });
    if (result.error || result.status !== 0) throw new Error(`Não foi possível salvar ${name} nas variáveis de ambiente do Windows.`);
  } else {
    const lines = readProfileBlock().filter((line) => !line.startsWith(`export ${name}=`));
    writeProfileBlock([...lines, `export ${name}='${value}'`]);
  }

  process.env[name] = value;
  cache.set(name, value);
}

export function removeUserEnv(name: string): void {
  if (IS_WINDOWS) {
    if (readWindowsValue(name) !== null) {
      const result = spawnSync('reg', ['delete', 'HKCU\\Environment', '/v', name, '/f'], { encoding: 'utf-8', stdio: 'pipe' });
      if (result.error || result.status !== 0) throw new Error(`Não foi possível remover ${name} das variáveis de ambiente do Windows.`);
    }
  } else {
    writeProfileBlock(readProfileBlock().filter((line) => !line.startsWith(`export ${name}=`)));
  }

  delete process.env[name];
  cache.set(name, null);
}
