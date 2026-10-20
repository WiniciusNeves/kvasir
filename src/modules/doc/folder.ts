import fs from 'fs';

// Where kvasir doc writes inside the project. Reuses the docs folder the project already has, with its
// real casing ("Doc/" here, "docs/" elsewhere): a fixed "DOC/" was the same folder as "Doc/" on
// Windows but a second folder on macOS/Linux.
const CANDIDATES = ['Doc', 'docs', 'DOC', 'doc'];
const DEFAULT_DIR = 'Doc';

export function projectDocsDir(root: string = process.cwd()): string {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return CANDIDATES.find((name) => entries.includes(name)) ?? DEFAULT_DIR;
}
