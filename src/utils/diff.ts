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

export interface DiffLine {
  type: ' ' | '-' | '+';
  text: string;
}

// Line diff (longest common subsequence) for showing a proposed change to a text file. Quadratic:
// meant for files of a few hundred lines, not for big generated files.
export function lineDiff(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: ' ', text: before[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: '-', text: before[i] });
      i += 1;
    } else {
      out.push({ type: '+', text: after[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ type: '-', text: before[i++] });
  while (j < m) out.push({ type: '+', text: after[j++] });
  return out;
}

// Only the changed lines with `context` unchanged lines around them ("…" between distant hunks).
export function formatDiff(diff: DiffLine[], context = 2): string {
  const keep = new Set<number>();
  diff.forEach((line, index) => {
    if (line.type === ' ') return;
    for (let k = Math.max(0, index - context); k <= Math.min(diff.length - 1, index + context); k += 1) keep.add(k);
  });
  const out: string[] = [];
  let last = -1;
  [...keep].sort((a, b) => a - b).forEach((index) => {
    if (last >= 0 && index > last + 1) out.push('   …');
    const line = diff[index];
    out.push(`${line.type === '+' ? '\x1b[32m+' : line.type === '-' ? '\x1b[31m-' : ' '} ${line.text}\x1b[0m`);
    last = index;
  });
  return out.join('\n');
}
