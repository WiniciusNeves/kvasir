import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { readJson, writeFile } from '@utils/fs';
import { isGitRepo, getRepoRoot } from '@utils/git';

// ~/.kvasir/config.json → { "daily": { "repos": ["C:/code/app", ...] } }

interface KvasirConfig {
  daily?: { repos?: string[] };
  [key: string]: unknown;
}

const SCAN_DEPTH = 2;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.expo', 'android', 'ios']);

function getConfigPath(): string {
  return path.join(os.homedir(), '.kvasir', 'config.json');
}

async function readConfig(): Promise<KvasirConfig> {
  return (await readJson<KvasirConfig>(getConfigPath())) ?? {};
}

export async function getConfiguredRepos(): Promise<string[]> {
  const repos = (await readConfig()).daily?.repos ?? [];
  return repos.filter((repo) => fs.pathExistsSync(repo));
}

export async function saveRepos(repos: string[]): Promise<void> {
  const config = await readConfig();
  config.daily = { ...config.daily, repos: Array.from(new Set(repos.map((repo) => path.resolve(repo)))) };
  await writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

// Git repositories inside `root` (the folder itself or up to 2 levels down).
export function findRepos(root: string): string[] {
  const absolute = path.resolve(root);
  if (!fs.pathExistsSync(absolute)) throw new Error(`Pasta não encontrada: ${absolute}`);

  const found: string[] = [];
  function walk(dir: string, depth: number): void {
    if (fs.pathExistsSync(path.join(dir, '.git'))) {
      found.push(dir);
      return;
    }
    if (depth >= SCAN_DEPTH) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(absolute, 0);
  return found;
}

export function currentRepo(): string | null {
  return isGitRepo(process.cwd()) ? getRepoRoot(process.cwd()) : null;
}

export function getConfigLocation(): string {
  return getConfigPath();
}
