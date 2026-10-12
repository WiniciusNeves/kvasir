import { spawnSync } from 'child_process';

export interface TypecheckResult {
  success: boolean;
  errorCount: number;
  output: string;
}

export function runTypecheck(): TypecheckResult {
  const result = spawnSync('npm', ['run', 'typecheck'], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    shell: process.platform === 'win32',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const errorCount = (output.match(/error TS\d+/g) ?? []).length;

  return { success: errorCount === 0, errorCount, output };
}
