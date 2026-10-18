import os from 'os';
import path from 'path';
import { confirm } from '@utils/prompt';
import { recordFeedback } from '@utils/feedback';
import { writeFile, readJson, copyFile, removeFile } from '@utils/fs';
import { recordOutcomeForCall } from '@ai/metrics';

// Backups and undo of kvasir fix / kvasir watch (~/.kvasir/backups/fix): one backup per file per run,
// taken before the first change; the manifest of the last run powers `kvasir fix --undo`.

export interface FixCall {
  id: string;
  task: string;
  model: string;
}

export interface FixBackup {
  filePath: string;
  backupPath: string;
  // AI calls whose fixes are in this file (kvasir watch): undoing them counts as a rejection
  calls?: FixCall[];
}

function getBackupDir(): string {
  return path.join(os.homedir(), '.kvasir', 'backups', 'fix');
}

function getManifestPath(): string {
  return path.join(getBackupDir(), 'last-fix.json');
}

// One backup per file per run, taken before the first change; the manifest of the last run powers `--undo`.
export async function ensureBackup(session: FixBackup[], filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const existing = session.find((backup) => backup.filePath === absolutePath);
  if (existing) return existing.backupPath;

  const extension = path.extname(absolutePath);
  const baseName = path.basename(absolutePath, extension);
  const backupPath = path.join(getBackupDir(), `${Date.now()}-${baseName}.kvasir-original${extension}`);

  await copyFile(absolutePath, backupPath);
  session.push({ filePath: absolutePath, backupPath });
  await writeFile(getManifestPath(), JSON.stringify(session, null, 2));

  return backupPath;
}

export async function attachCallToBackup(session: FixBackup[], filePath: string, call: FixCall): Promise<void> {
  const backup = session.find((item) => item.filePath === path.resolve(filePath));
  if (!backup) return;
  backup.calls = [...(backup.calls ?? []), call];
  await writeFile(getManifestPath(), JSON.stringify(session, null, 2));
}

export async function undoLastFix(): Promise<void> {
  const manifest = await readJson<FixBackup[]>(getManifestPath());
  if (!manifest || manifest.length === 0) {
    console.log('Nenhuma correção do kvasir fix para desfazer.');
    return;
  }

  console.log('\nArquivos alterados pelo último kvasir fix:');
  manifest.forEach((backup) => console.log(`  - ${path.relative(process.cwd(), backup.filePath)}`));

  const approved = await confirm(`Restaurar ${manifest.length} arquivo(s) para a versão anterior?`);
  if (!approved) {
    console.log('Nada foi restaurado.');
    return;
  }

  for (const backup of manifest) {
    await copyFile(backup.backupPath, backup.filePath);
    await removeFile(backup.backupPath);
  }
  await removeFile(getManifestPath());
  // the user overruled the validation: the models that made these fixes get a rejection
  for (const call of manifest.flatMap((backup) => backup.calls ?? [])) await recordOutcomeForCall(call, 'rejected');
  await recordFeedback('fixes', 'rejected', `undo: ${manifest.length} arquivo(s) restaurado(s)`);

  console.log(`✅ ${manifest.length} arquivo(s) restaurado(s).`);
}
