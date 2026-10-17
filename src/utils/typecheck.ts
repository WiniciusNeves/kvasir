import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import { runCommand } from '@utils/process';

export interface TypecheckResult {
  success: boolean;
  errorCount: number;
  output: string;
  diagnostics: TscDiagnostic[];
}

export interface TscDiagnostic {
  filePath: string;
  lineIndex: number;
  column: number;
  code: string;
  message: string;
}

// Matches both tsc formats:
//   src/a.ts(12,5): error TS2345: message        (no TTY / --pretty false)
//   src/a.ts:12:5 - error TS2345: message        (terminal / --pretty)
const DIAGNOSTIC_REGEX =
  /^\s*(.+?\.(?:tsx?|jsx?|mts|cts))(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*(?:-|:)\s*error\s+(TS\d+):\s*(.*)$/gm;
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function parseTscDiagnostics(output: string): TscDiagnostic[] {
  const clean = output.replace(ANSI_REGEX, '').replace(/\r/g, '');
  const diagnostics: TscDiagnostic[] = [];

  for (const match of clean.matchAll(DIAGNOSTIC_REGEX)) {
    const line = match[2] ?? match[4];
    const column = match[3] ?? match[5];
    diagnostics.push({
      filePath: match[1].trim(),
      lineIndex: parseInt(line, 10) - 1,
      column: parseInt(column, 10),
      code: match[6],
      message: match[7].trim(),
    });
  }

  return diagnostics;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function hasTypecheckScript(): boolean {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  if (!fs.pathExistsSync(packageJsonPath)) return false;
  const pkg = fs.readJsonSync(packageJsonPath) as PackageJson;
  return Boolean(pkg.scripts?.typecheck);
}

// Runs the project's own tsc through node (no shell at all) so the output format is predictable.
// Falls back to the project's "typecheck" script. Never `npx tsc`: without typescript installed
// it downloads an unrelated package called "tsc".
export function runTypecheck(): TypecheckResult {
  const localTsc = path.resolve(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');

  let result;
  if (fs.pathExistsSync(localTsc)) {
    result = spawnSync(process.execPath, [localTsc, '--noEmit', '--pretty', 'false'], {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });
  } else if (hasTypecheckScript()) {
    result = runCommand('npm', ['run', 'typecheck']);
  } else {
    throw new Error('TypeScript não está instalado neste projeto e não há script "typecheck" no package.json.');
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const diagnostics = parseTscDiagnostics(output);
  const errorCount = (output.match(/error TS\d+/g) ?? []).length;

  // A crash or missing tsc exits non-zero without any "error TS" line: that is not a success.
  const success = !result.error && result.status === 0 && errorCount === 0;

  return { success, errorCount, output, diagnostics };
}
