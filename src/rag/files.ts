import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { checkStagedFiles, checkAddedLines } from '@modules/guard/rules';

// Which files of a folder go into the index. Git repos: what git tracks plus untracked files that
// are not ignored (so .gitignore is respected). Other folders: a walk with the usual ignores.
// Files the guard would block (.env, keys) never go in, and lines with secrets are blanked.

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.mdx', '.json', '.yml', '.yaml',
  '.py', '.java', '.kt', '.swift', '.go', '.rs', '.rb', '.php', '.cs', '.dart', '.vue', '.svelte',
  '.css', '.scss', '.sql', '.prisma', '.graphql', '.sh', '.txt',
]);
const IGNORED_DIRS = /(^|\/)(node_modules|dist|build|out|coverage|\.git|\.next|\.expo|\.turbo|\.cache|android\/app\/build|ios\/Pods)\//;
const IGNORED_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$|\.min\.(js|css)$|\.map$/;
const MAX_FILE_BYTES = 200_000;

function gitFiles(root: string): string[] | null {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function walk(root: string, dir: string = root, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.test(`${relative}/`)) walk(root, full, files);
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

export function listIndexableFiles(root: string): string[] {
  const all = gitFiles(root) ?? walk(root);
  const blocked = new Set(checkStagedFiles(all).map((finding) => finding.filePath));

  return all.filter((file) => {
    if (blocked.has(file) || IGNORED_DIRS.test(file) || IGNORED_FILES.test(file)) return false;
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) return false;
    try {
      const stat = fs.statSync(path.join(root, file));
      return stat.isFile() && stat.size > 0 && stat.size <= MAX_FILE_BYTES;
    } catch {
      return false;
    }
  });
}

// The file's text with every line the guard would block replaced by a placeholder.
export function readWithoutSecrets(root: string, file: string): string {
  const content = fs.readFileSync(path.join(root, file), 'utf-8');
  const lines = content.split(/\r?\n/);
  const findings = checkAddedLines(lines.map((text, index) => ({ filePath: file, lineNumber: index + 1, text })));
  for (const finding of findings) {
    if (finding.severity === 'block' && finding.lineNumber) lines[finding.lineNumber - 1] = '[linha removida: possível segredo]';
  }
  return lines.join('\n');
}
