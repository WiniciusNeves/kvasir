export interface AddedLine {
  filePath: string;
  lineNumber: number;
  text: string;
}

// Added (+) lines of a unified diff with their real line numbers in the new file.
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let filePath = '';
  let lineNumber = 0;

  for (const line of diff.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('+++ ')) {
      filePath = line.replace(/^\+\+\+ (b\/)?/, '').trim();
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNumber = parseInt(hunk[1], 10);
      continue;
    }

    if (line.startsWith('+')) {
      added.push({ filePath, lineNumber, text: line.slice(1) });
      lineNumber += 1;
    } else if (!line.startsWith('-') && !line.startsWith('\\')) {
      // context line (lines before the first hunk don't matter: the hunk header resets the count)
      lineNumber += 1;
    }
  }

  return added;
}

// Lines added + removed (headers excluded): how big a staged change is.
export function countChangedLines(diff: string): number {
  return diff
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++ ')) || (line.startsWith('-') && !line.startsWith('--- '))).length;
}

// Packages added to a package.json in the diff. A version bump (same name removed and added) does
// not count, and neither do the package's own fields ("name", "version", scripts...).
export function parseAddedDependencies(diff: string): string[] {
  const added = new Set<string>();
  const removed = new Set<string>();
  let inPackageJson = false;
  let section = '';

  for (const line of diff.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      inPackageJson = /\/package\.json$/.test(line.split(' ').pop() ?? '');
      section = '';
      continue;
    }
    if (!inPackageJson || line.startsWith('+++ ') || line.startsWith('--- ')) continue;

    const content = line.slice(1);
    const sectionMatch = content.match(/^\s*"((?:dev|peer|optional)?[dD]ependencies)"\s*:\s*\{/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (/^\s*\}/.test(content)) {
      section = '';
      continue;
    }
    if (!section) continue;

    const entry = content.match(/^\s*"((?:@[^"/]+\/)?[^"/]+)"\s*:\s*"[^"]*"/);
    if (!entry) continue;
    if (line.startsWith('+')) added.add(entry[1]);
    else if (line.startsWith('-')) removed.add(entry[1]);
  }

  return [...added].filter((name) => !removed.has(name));
}
