import path from 'path';

// Splits a file into pieces that make sense on their own: code by top-level declaration, markdown by
// heading, everything else by line windows. Small pieces are merged, big ones split with overlap.

export interface Chunk {
  file: string;
  // 1-based, inclusive
  startLine: number;
  endLine: number;
  text: string;
}

const MAX_LINES = 60;
const MIN_LINES = 8;
const OVERLAP = 8;

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|kt|swift|go|rs|rb|php|cs|dart|vue|svelte)$/i;
const MARKDOWN = /\.(md|mdx)$/i;
// a declaration at column 0 starts a new piece
const CODE_BOUNDARY = /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var|interface|type|enum|def|fun|func|struct|impl|public|private|protected)\b/;
const HEADING = /^#{1,3}\s/;

interface Segment {
  start: number;
  end: number;
}

function boundaries(lines: string[], isBoundary: (line: string) => boolean): Segment[] {
  const starts = [0];
  lines.forEach((line, index) => {
    if (index > 0 && isBoundary(line)) starts.push(index);
  });
  return starts.map((start, index) => ({ start, end: (starts[index + 1] ?? lines.length) - 1 }));
}

// Merge neighbours while they stay small, then split what is still too long.
function normalize(segments: Segment[]): Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    const lastSize = last ? last.end - last.start + 1 : Infinity;
    const size = segment.end - segment.start + 1;
    if (last && (lastSize < MIN_LINES || size < MIN_LINES) && lastSize + size <= MAX_LINES) last.end = segment.end;
    else merged.push({ ...segment });
  }

  const result: Segment[] = [];
  for (const segment of merged) {
    if (segment.end - segment.start + 1 <= MAX_LINES) {
      result.push(segment);
      continue;
    }
    for (let start = segment.start; start <= segment.end; start += MAX_LINES - OVERLAP) {
      result.push({ start, end: Math.min(start + MAX_LINES - 1, segment.end) });
      if (start + MAX_LINES - 1 >= segment.end) break;
    }
  }
  return result;
}

export function chunkFile(file: string, content: string): Chunk[] {
  const lines = content.split('\n');
  const name = path.basename(file);
  const segments = CODE_EXTENSIONS.test(name)
    ? boundaries(lines, (line) => CODE_BOUNDARY.test(line))
    : MARKDOWN.test(name)
      ? boundaries(lines, (line) => HEADING.test(line))
      : [{ start: 0, end: lines.length - 1 }];

  return normalize(segments)
    .map((segment) => ({
      file,
      startLine: segment.start + 1,
      endLine: segment.end + 1,
      text: lines.slice(segment.start, segment.end + 1).join('\n').trimEnd(),
    }))
    .filter((chunk) => chunk.text.trim().length > 0);
}

// What gets embedded: the path helps ("cart" in "src/cart.ts" says what the piece is about).
export function embeddingText(chunk: Chunk): string {
  return `Arquivo: ${chunk.file} (linhas ${chunk.startLine}-${chunk.endLine})\n${chunk.text}`;
}
