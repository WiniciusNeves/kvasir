import path from 'path';
import fs from 'fs-extra';

const IMPORT_REGEX = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

// tsconfig.json allows comments and trailing commas; JSON.parse doesn't. Strings are matched first and
// kept as they are, because they hold the same characters ("@utils/*" is not the start of a comment).
const JSON_STRING = '"(?:[^"\\\\]|\\\\.)*"';
const JSON_COMMENTS = new RegExp(`(${JSON_STRING})|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/`, 'g');
const JSON_TRAILING_COMMAS = new RegExp(`(${JSON_STRING})|,(?=\\s*[}\\]])`, 'g');

function readJsonWithComments(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const clean = raw.replace(JSON_COMMENTS, (_match, text?: string) => text ?? '').replace(JSON_TRAILING_COMMAS, (_match, text?: string) => text ?? '');
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
const MAX_SIBLINGS = 60;

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

// Where a local import would land (relative or tsconfig alias), whether the file exists or not.
function intendedPath(specifier: string, fromFile: string, tsconfig: TsconfigPaths | null): string | null {
  if (specifier.startsWith('.')) return path.resolve(path.dirname(fromFile), specifier);
  for (const [alias, targets] of Object.entries(tsconfig?.paths ?? {})) {
    if (!alias.endsWith('*') || !specifier.startsWith(alias.slice(0, -1))) continue;
    const rest = specifier.slice(alias.length - 1);
    for (const target of targets) {
      const candidate = path.resolve(tsconfig?.baseUrl ?? '.', target.replace(/\*$/, '') + rest);
      if (fs.pathExistsSync(path.dirname(candidate))) return candidate;
    }
  }
  return null;
}

// For a local import that does not resolve: the imports that DO exist in the folder it points to,
// written the same way ("@utils/dropdownOption" → "@utils/dropdownOptions", "@utils/apiErrors"…).
export function listSiblingImports(specifier: string, fromFile: string, root: string = process.cwd()): string[] {
  const intended = intendedPath(specifier, path.resolve(root, fromFile), readTsconfigPaths(root));
  if (!intended) return [];
  const folder = path.dirname(intended);
  const prefix = specifier.slice(0, specifier.lastIndexOf('/') + 1);

  const names = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory()
        ? EXTENSIONS.some((extension) => extension.startsWith('/index') && fs.pathExistsSync(path.join(folder, entry.name + extension)))
        : SOURCE_EXTENSIONS.test(entry.name) && !/\.(test|spec)\.|\.d\.ts$/.test(entry.name)
    )
    .map((entry) => entry.name.replace(SOURCE_EXTENSIONS, ''));
  return Array.from(new Set(names))
    .sort()
    .slice(0, MAX_SIBLINGS)
    .map((name) => `${prefix}${name}`);
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

export interface ImportedDefinition {
  file: string;
  name: string;
  code: string;
}

const NAMED_IMPORT = /import\s+(?!type\b)(?:[\w$]+\s*,\s*)?\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
const MAX_DEFINITION_LINES = 40;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The exported declaration of `name`: from its line up to the next top-level export.
function extractDefinition(code: string, name: string): string | null {
  const lines = code.split(/\r?\n/);
  const declaration = new RegExp(`^export\\s+(?:async\\s+)?(?:function\\*?|const|let|var|class|enum)\\s+${escapeRegExp(name)}\\b`);
  const start = lines.findIndex((line) => declaration.test(line));
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && /^export\s/.test(line));
  const end = Math.min(next === -1 ? lines.length : next, start + MAX_DEFINITION_LINES);
  return lines.slice(start, end).join('\n').trimEnd();
}

// The real code of the project functions a file imports by name ("import { isValidCPF } from './utils'"),
// so a model reads what they do instead of guessing (a CPF that fails the check digit is not a bug).
export function importedDefinitions(filePath: string, content: string, root: string = process.cwd()): ImportedDefinition[] {
  const tsconfig = readTsconfigPaths(root);
  const absolute = path.resolve(root, filePath);
  const definitions: ImportedDefinition[] = [];

  for (const match of content.matchAll(NAMED_IMPORT)) {
    const resolved = resolveSpecifier(match[2], absolute, tsconfig);
    if (!resolved || resolved.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const code = fs.readFileSync(resolved, 'utf-8');
    const names = match[1]
      .split(',')
      .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
      .filter(Boolean);
    for (const name of names) {
      const definition = extractDefinition(code, name);
      if (definition) definitions.push({ file: path.relative(root, resolved).split(path.sep).join('/'), name, code: definition });
    }
  }
  return definitions;
}
