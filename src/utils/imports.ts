import path from 'path';
import fs from 'fs-extra';

const IMPORT_REGEX = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

// tsconfig.json allows comments and trailing commas; JSON.parse doesn't.
function readJsonWithComments(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const clean = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(clean);
}

export function readTsconfigText(root: string = process.cwd()): string | null {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  return fs.pathExistsSync(tsconfigPath) ? fs.readFileSync(tsconfigPath, 'utf-8') : null;
}

function readTsconfigPaths(root: string): TsconfigPaths | null {
  const tsconfigPath = path.join(root, 'tsconfig.json');
  if (!fs.pathExistsSync(tsconfigPath)) return null;

  try {
    const json = readJsonWithComments(tsconfigPath) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
    const options = json.compilerOptions ?? {};
    return { baseUrl: path.resolve(root, options.baseUrl ?? '.'), paths: options.paths ?? {} };
  } catch {
    return null;
  }
}

function tryResolve(base: string): string | null {
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (fs.pathExistsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function resolveSpecifier(specifier: string, fromFile: string, tsconfig: TsconfigPaths | null): string | null {
  if (specifier.startsWith('.')) return tryResolve(path.resolve(path.dirname(fromFile), specifier));
  if (!tsconfig) return null;

  for (const [alias, targets] of Object.entries(tsconfig.paths)) {
    const prefix = alias.replace(/\*$/, '');
    if (!alias.endsWith('*') ? specifier !== alias : !specifier.startsWith(prefix)) continue;

    const rest = specifier.slice(prefix.length);
    for (const target of targets) {
      const resolved = tryResolve(path.resolve(tsconfig.baseUrl, target.replace(/\*$/, '') + (alias.endsWith('*') ? rest : '')));
      if (resolved) return resolved;
    }
  }
  return null;
}

export function listImportSpecifiers(content: string): string[] {
  return [...content.matchAll(IMPORT_REGEX)].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean);
}

// Project files imported by `filePath` (relative imports and tsconfig path aliases), relative to cwd.
export function resolveLocalImports(filePath: string, content: string, root: string = process.cwd()): string[] {
  const tsconfig = readTsconfigPaths(root);
  const absolute = path.resolve(root, filePath);

  const resolved = listImportSpecifiers(content)
    .map((specifier) => resolveSpecifier(specifier, absolute, tsconfig))
    .filter((file): file is string => file !== null && !file.includes(`${path.sep}node_modules${path.sep}`))
    .map((file) => path.relative(root, file));

  return Array.from(new Set(resolved));
}

const SOURCE_EXTENSIONS = /\.(tsx?|jsx?|d\.ts)$/;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.expo', 'coverage']);
const MAX_SIMILAR = 5;

function walkSourceFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, results);
    else if (SOURCE_EXTENSIONS.test(entry.name)) results.push(full);
  }
  return results;
}

// For an import that doesn't resolve, project files with the same base name ("@/utils/money" →
// "src/util/money.ts"): usually the real cause is a typo in the folder or alias.
export function findFilesNamedLike(specifier: string, root: string = process.cwd()): string[] {
  const baseName = path.basename(specifier).replace(SOURCE_EXTENSIONS, '');
  if (!baseName || baseName === '*') return [];

  return walkSourceFiles(root)
    .filter((file) => path.basename(file).replace(SOURCE_EXTENSIONS, '').replace(/\.d$/, '') === baseName)
    .slice(0, MAX_SIMILAR)
    .map((file) => path.relative(root, file).split(path.sep).join('/'));
}

export function isResolvableImport(specifier: string, fromFile: string, root: string = process.cwd()): boolean {
  return resolveSpecifier(specifier, path.resolve(root, fromFile), readTsconfigPaths(root)) !== null;
}

const EXPORT_REGEX =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

// Exported names, found deterministically so models work with real names instead of inventing them.
export function listExports(code: string): string[] {
  const names = [...code.matchAll(EXPORT_REGEX)].map((match) => match[1]);
  if (/^export\s+default\s+(?!async|function|class|const|let|var|interface|type|enum)/m.test(code)) names.push('default');
  return Array.from(new Set(names));
}
