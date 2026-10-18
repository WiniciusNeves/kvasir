import fs from 'fs-extra';
import path from 'path';

export async function readJson<T>(filePath: string): Promise<T | null> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const exists = await fs.pathExists(fullPath);
  if (!exists) return null;
  return fs.readJson(fullPath) as Promise<T>;
}

export async function writeFile(filePath: string, content: string): Promise<void> {
  const fullPath = path.resolve(process.cwd(), filePath);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
}

export async function readFile(filePath: string): Promise<string | null> {
  const fullPath = path.resolve(process.cwd(), filePath);
  const exists = await fs.pathExists(fullPath);
  if (!exists) return null;
  return fs.readFile(fullPath, 'utf-8');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

export async function pathExists(targetPath: string): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  return fs.pathExists(fullPath);
}

export async function copyFile(sourcePath: string, destinationPath: string): Promise<void> {
  const fullSource = path.resolve(process.cwd(), sourcePath);
  const fullDestination = path.resolve(process.cwd(), destinationPath);
  await fs.copy(fullSource, fullDestination);
}

export async function removeFile(targetPath: string): Promise<void> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  await fs.remove(fullPath);
}

export async function isDirectory(targetPath: string): Promise<boolean> {
  const fullPath = path.resolve(process.cwd(), targetPath);
  const exists = await fs.pathExists(fullPath);
  if (!exists) return false;
  const stats = await fs.stat(fullPath);
  return stats.isDirectory();
}

const DEFAULT_IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '.turbo', 'coverage', 'DOC'];

export interface ListFilesOptions {
  extensions?: string[];
  ignoreDirs?: string[];
}

export async function listFilesRecursive(rootDir: string, options: ListFilesOptions = {}): Promise<string[]> {
  const { extensions, ignoreDirs = DEFAULT_IGNORED_DIRS } = options;
  const fullRoot = path.resolve(process.cwd(), rootDir);

  async function walk(dir: string): Promise<string[]> {
    const exists = await fs.pathExists(dir);
    if (!exists) return [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirs.includes(entry.name)) continue;
        results.push(...(await walk(fullPath)));
        continue;
      }

      if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) {
        results.push(path.relative(fullRoot, fullPath));
      }
    }

    return results;
  }

  return walk(fullRoot);
}

export async function appendLine(filePath: string, line: string): Promise<void> {
  const fullPath = path.resolve(process.cwd(), filePath);
  await ensureDir(path.dirname(fullPath));
  await fs.appendFile(fullPath, `${line}\n`, 'utf-8');
}
