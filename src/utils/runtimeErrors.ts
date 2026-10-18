import path from 'path';
import fs from 'fs';
import { findFilesNamedLike } from '@utils/imports';

// Runtime errors (exceptions and failed tests) read from command output or the clipboard: the error
// and the stack frames that point to files of THIS project (node_modules, node internals and bundle
// URLs are dropped). Deterministic parsing only.

export interface StackFrame {
  // relative to the project root, forward slashes
  filePath: string;
  lineIndex: number;
  column: number;
  fn: string | null;
}

export interface RuntimeError {
  type: string;
  message: string;
  // project frames, innermost first (at most MAX_FRAMES)
  frames: StackFrame[];
  // same error, same place: used to deduplicate and to notice it coming back after a fix
  signature: string;
  // the error block as printed (for prompts)
  raw: string;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const MAX_FRAMES = 5;
const BLOCK_LINES = 40;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//;

// "TypeError: x", "⨯ TypeError: x", "ERROR  TypeError: x", "Uncaught ReferenceError: x", "AssertionError: x"
const HEADLINE = /^\s*(?:⨯\s*|ERROR\s+|Uncaught\s+|\[[^\]]+\]\s+)?((?:[A-Z][\w$]*)?(?:Error|Exception))(?:\s*\[[\w-]+\])?:\s+(.+)$/;
// jest: "expect(received).toBe(expected) // Object.is equality"
const JEST_ASSERTION = /^\s*expect\((?:received|[^)]*)\)\.(\w+)\(/;
// V8: "at fn (file:line:col)", "at file:line:col", "at async fn (file:line:col)"
const V8_FRAME = /^\s*at\s+(?:(?:async\s+)?(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
// Next.js: "src/app/page.tsx (12:5) @ Home"
const NEXT_FRAME = /^\s*(?:⨯\s*)?(\S+\.[cm]?[jt]sx?)\s+\((\d+):(\d+)\)\s+@\s+(\S+)/;
// React component stack: "in Cart (at Cart.tsx:12)"
const COMPONENT_FRAME = /\(at\s+([\w./@-]+\.[cm]?[jt]sx?):(\d+)(?::(\d+))?\)/;

export function isTestFile(filePath: string): boolean {
  return TEST_FILE.test(filePath.replace(/\\/g, '/'));
}

function cleanPath(raw: string): string {
  let value = raw.trim().replace(/^file:\/\/\/?/, '');
  value = value.replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?/, '').replace(/^\([^)]*\)\//, '');
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep as is
  }
  // "/C:/proj/src/a.ts" (from file:///C:/...) → "C:/proj/src/a.ts"
  if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
  return value.replace(/^\.\//, '');
}

// A path from the stack → a file of this project (relative), or null.
function resolveProjectFile(raw: string, root: string): string | null {
  const value = cleanPath(raw);
  if (!value || /^(node:|internal\/|https?:|<anonymous>|native)/.test(value)) return null;
  if (/(^|[\\/])node_modules[\\/]/.test(value)) return null;

  const candidates = path.isAbsolute(value) ? [value] : [path.resolve(root, value)];
  for (const candidate of candidates) {
    const relative = path.relative(root, candidate);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(candidate)) {
      return relative.split(path.sep).join('/');
    }
  }

  // bare names ("Cart.tsx" from a component stack): only when exactly one project file matches
  if (!value.includes('/') && !value.includes('\\')) {
    const matches = findFilesNamedLike(value, root).filter((file) => path.basename(file) === value);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function parseFrame(line: string, root: string): StackFrame | null {
  const next = line.match(NEXT_FRAME);
  if (next) {
    const filePath = resolveProjectFile(next[1], root);
    return filePath ? { filePath, lineIndex: Number(next[2]) - 1, column: Number(next[3]), fn: next[4] } : null;
  }
  const v8 = line.match(V8_FRAME);
  if (v8) {
    const filePath = resolveProjectFile(v8[2], root);
    return filePath ? { filePath, lineIndex: Number(v8[3]) - 1, column: Number(v8[4]), fn: v8[1] ?? null } : null;
  }
  const component = line.match(COMPONENT_FRAME);
  if (component) {
    const filePath = resolveProjectFile(component[1], root);
    return filePath ? { filePath, lineIndex: Number(component[2]) - 1, column: Number(component[3] ?? 1), fn: null } : null;
  }
  return null;
}

function jestMessage(lines: string[], start: number): string {
  const expected = lines.slice(start, start + 8).find((line) => /^\s*Expected:/.test(line))?.trim();
  const received = lines.slice(start, start + 8).find((line) => /^\s*Received:/.test(line))?.trim();
  return [lines[start].trim(), expected, received].filter(Boolean).join(' · ');
}

export function parseRuntimeErrors(output: string, root: string = process.cwd()): RuntimeError[] {
  const lines = output.replace(ANSI, '').replace(/\r/g, '').split('\n');
  const errors: RuntimeError[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const headline = lines[index].match(HEADLINE);
    const jest = !headline ? lines[index].match(JEST_ASSERTION) : null;
    if (!headline && !jest) continue;

    const type = headline ? headline[1] : 'AssertionError';
    const message = headline ? headline[2].trim() : jestMessage(lines, index);
    const block = lines.slice(index, index + BLOCK_LINES);

    const frames: StackFrame[] = [];
    for (const line of block.slice(1)) {
      // the next error starts: its frames are not ours
      if (HEADLINE.test(line) || JEST_ASSERTION.test(line)) break;
      const frame = parseFrame(line, root);
      if (frame && !frames.some((item) => item.filePath === frame.filePath && item.lineIndex === frame.lineIndex)) frames.push(frame);
      if (frames.length >= MAX_FRAMES) break;
    }
    if (frames.length === 0) continue;

    const signature = `${type}|${message}|${frames[0].filePath}:${frames[0].lineIndex + 1}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    errors.push({ type, message, frames, signature, raw: block.join('\n').trim() });
  }

  return errors;
}
