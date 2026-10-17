import path from 'path';
import { runCommand, commandSucceeded } from '@utils/process';

const CODE_TIMEOUT_MS = 15_000;

export function openInEditor(filePath: string): boolean {
  const opened = commandSucceeded(runCommand('code', [path.resolve(filePath)], { timeoutMs: CODE_TIMEOUT_MS }));

  if (!opened) {
    console.log('⚠️  Não foi possível abrir o VS Code (o comando "code" está no PATH?).');
  }

  return opened;
}

export function openDiffInEditor(originalPath: string, modifiedPath: string): boolean {
  const absoluteOriginal = path.resolve(originalPath);
  const absoluteModified = path.resolve(modifiedPath);

  console.log('\n📂 Abrindo diff lado a lado no VS Code...');

  const opened = commandSucceeded(
    runCommand('code', ['--diff', absoluteOriginal, absoluteModified], { timeoutMs: CODE_TIMEOUT_MS })
  );

  if (!opened) {
    console.log('⚠️  Não foi possível abrir o diff no VS Code (o comando "code" está no PATH?). Veja a diferença acima.');
  }

  return opened;
}
