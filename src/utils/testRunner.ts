import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';

export type TestFramework = 'jest' | 'vitest';

export interface TestRunResult {
  passed: boolean;
  output: string;
}

const BINARIES: Record<TestFramework, string> = {
  jest: path.join('node_modules', 'jest', 'bin', 'jest.js'),
  vitest: path.join('node_modules', 'vitest', 'vitest.mjs'),
};

const TEST_TIMEOUT_MS = 180_000;
const ANSI = /\x1b\[[0-9;]*m/g;

export function hasLocalTestRunner(framework: TestFramework): boolean {
  return fs.pathExistsSync(path.resolve(process.cwd(), BINARIES[framework]));
}

// Runs ONE test file with the project's own runner through node (no shell, no npx download).
export function runTestFile(framework: TestFramework, testFile: string): TestRunResult {
  const bin = path.resolve(process.cwd(), BINARIES[framework]);
  const args = framework === 'jest' ? [bin, testFile, '--ci', '--colors=false'] : [bin, 'run', testFile];

  const result = spawnSync(process.execPath, args, {
    encoding: 'utf-8',
    cwd: process.cwd(),
    timeout: TEST_TIMEOUT_MS,
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI, '').trim();
  return { passed: !result.error && result.status === 0, output };
}
