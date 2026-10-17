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
