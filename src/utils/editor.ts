import { spawnSync } from 'child_process';

export function openInEditor(filePath: string): void {
  spawnSync('code', [filePath]);
}

export function openDiffInEditor(originalPath: string, modifiedPath: string): void {
  spawnSync('code', ['--diff', originalPath, modifiedPath], {
    encoding: 'utf-8',
  });
}
