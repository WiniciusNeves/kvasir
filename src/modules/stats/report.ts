import os from 'os';
import path from 'path';
import { writeFile } from '@utils/fs';
import { openInDefaultApp } from '@utils/process';

// HTML reports live in ~/.kvasir/reports/ (personal data: never in the project folder or in git).

export function getReportsDir(): string {
  return path.join(os.homedir(), '.kvasir', 'reports');
}

export async function writeReport(fileName: string, html: string): Promise<string> {
  const filePath = path.join(getReportsDir(), fileName);
  await writeFile(filePath, html);
  return filePath;
}

export function openReport(filePath: string): void {
  if (openInDefaultApp(filePath)) console.log('🌐 Aberto no navegador.');
  else console.log(`Não consegui abrir o navegador. Abra o arquivo: ${filePath}`);
}
