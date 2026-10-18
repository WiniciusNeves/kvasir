import path from 'path';
import { askLocal } from '@ai/router';
import { cleanAnswer, truncateForPrompt } from '@ai/parse';
import { listExports } from '@utils/imports';
import { confirm, checkbox, select, input } from '@utils/prompt';
import { writeFile, readFile, pathExists, isDirectory, listFilesRecursive } from '@utils/fs';

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const SPECIFIC_FILE_OPTION = '__specific_file__';
const WHOLE_PROJECT_OPTION = '__whole_project__';

export interface RunDocCodeOptions {
  all?: boolean;
  force?: boolean;
}

interface RootFolderSummary {
  name: string;
  fileCount: number;
}

function toRelativePosixPath(relativeFilePath: string): string {
  return relativeFilePath.split(path.sep).join('/');
}

function toDocOutputPath(relativeFilePath: string): string {
  const normalized = toRelativePosixPath(relativeFilePath);
  const withoutExt = normalized.replace(/\.[^./]+$/, '');
  return `DOC/code/${withoutExt}.md`;
}

const MAX_CODE_CHARS = 12_000;
function buildCodeDocPrompt(relativeFilePath: string, code: string): string {
  const exportsList = listExports(code);

  return `Você documenta código-fonte em português do Brasil, para outros desenvolvedores do time.

Arquivo: ${relativeFilePath}
Exports encontrados: ${exportsList.length > 0 ? exportsList.join(', ') : '(nenhum)'}

Código:
\`\`\`
${truncateForPrompt(code, MAX_CODE_CHARS)}
\`\`\`

Escreva a documentação em markdown com exatamente estas seções:

## Propósito
O que este arquivo faz, em 2-3 frases.

## Exports
Um item por export da lista "Exports encontrados" (e só eles), com uma frase do que faz. Se não houver exports, escreva "Nenhum".

## Como usar
Um exemplo curto de uso de um export real deste arquivo. Se não fizer sentido, escreva "Não se aplica".

Regras: descreva só o que está no código; não invente funções, parâmetros nem dependências. Comece direto em "## Propósito".`;
}

async function documentFile(relativeFilePath: string): Promise<void> {
  const code = await readFile(relativeFilePath);
  if (code === null) {
    console.log(`Não foi possível ler o arquivo: ${relativeFilePath}`);
    return;
  }

  const summary = cleanAnswer(await askLocal('doc', buildCodeDocPrompt(relativeFilePath, code), { temperature: 0.2 }));
  await writeFile(toDocOutputPath(relativeFilePath), `# ${relativeFilePath}\n\n${summary}\n`);
}

function summarizeRootFolders(files: string[]): RootFolderSummary[] {
  const counts = new Map<string, number>();

  for (const file of files) {
    const segments = toRelativePosixPath(file).split('/');
    if (segments.length < 2) continue;

    const folderName = segments[0];
    counts.set(folderName, (counts.get(folderName) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function processFilesWithProgress(files: string[], force: boolean): Promise<void> {
  const total = files.length;

  for (let index = 0; index < total; index += 1) {
    const file = files[index];
    const position = index + 1;
    const outputPath = toDocOutputPath(file);

    if (!force && (await pathExists(outputPath))) {
      console.log(`Documentando ${position}/${total} — ${file} (já existe, pulando)`);
      continue;
    }

    console.log(`Documentando ${position}/${total} — ${file}`);
    await documentFile(file);
  }

  console.log(`\nConcluído: ${total} arquivo(s) processado(s).`);
}

async function documentSingleFile(relativeFilePath: string): Promise<void> {
  const outputPath = toDocOutputPath(relativeFilePath);

  console.log(`\nThis will document ${relativeFilePath} → ${outputPath}`);
  const approved = await confirm(`Document ${relativeFilePath}?`);
  if (!approved) {
    console.log('Skipped.');
    return;
  }

  await documentFile(relativeFilePath);
  console.log(`Saved: ${outputPath}`);
}

async function documentFolder(relativeDirPath: string): Promise<void> {
  const files = await listFilesRecursive(relativeDirPath, { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log(`No source files found under ${relativeDirPath}`);
    return;
  }

  console.log(`\nFound ${files.length} file(s) under ${relativeDirPath}:`);
  files.forEach((file) => console.log(`  - ${file}`));

  for (const file of files) {
    const relativeFilePath = toRelativePosixPath(path.join(relativeDirPath, file));
    const approved = await confirm(`Document ${relativeFilePath}?`);
    if (!approved) {
      console.log(`Skipped: ${relativeFilePath}`);
      continue;
    }

    await documentFile(relativeFilePath);
    console.log(`Saved: ${toDocOutputPath(relativeFilePath)}`);
  }
}

async function documentTargetPath(target: string): Promise<void> {
  const exists = await pathExists(target);
  if (!exists) {
    console.log(`Path not found: ${target}`);
    return;
  }

  if (await isDirectory(target)) {
    await documentFolder(target);
    return;
  }

  await documentSingleFile(target);
}

async function runDocAll(force: boolean): Promise<void> {
  const files = await listFilesRecursive('.', { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log('No source files found in this project.');
    return;
  }

  console.log(`\nThis will document ${files.length} file(s) across the project.`);
  const approved = await confirm('Continue?');
  if (!approved) {
    console.log('Cancelled.');
    return;
  }

  await processFilesWithProgress(files, force);
}

async function selectFilesInFolder(folderName: string): Promise<void> {
  const files = await listFilesRecursive(folderName, { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log(`No source files found under ${folderName}/`);
    return;
  }

  const selected = await checkbox<string>(
    `Selecione os arquivos de ${folderName}/:`,
    files.map((file) => ({ name: file, value: file }))
  );

  if (selected.length === 0) {
    console.log('No files selected.');
    return;
  }

  const relativeSelected = selected.map((file) => toRelativePosixPath(path.join(folderName, file)));

  console.log('\nSelected files:');
  relativeSelected.forEach((file) => console.log(`  - ${file}`));

  const approved = await confirm(`Document these ${relativeSelected.length} file(s)?`);
  if (!approved) {
    console.log('Cancelled.');
    return;
  }

  await processFilesWithProgress(relativeSelected, true);
}

async function selectFilesAtRoot(files: string[]): Promise<void> {
  console.log(`\nFound ${files.length} source file(s) at the project root.`);

  const selected = await checkbox<string>(
    'Select files to document:',
    files.map((file) => ({ name: file, value: file }))
  );

  if (selected.length === 0) {
    console.log('No files selected.');
    return;
  }

  const approved = await confirm(`Document these ${selected.length} file(s)?`);
  if (!approved) {
    console.log('Cancelled.');
    return;
  }

  await processFilesWithProgress(selected, true);
}

async function runInteractiveSelection(): Promise<void> {
  const files = await listFilesRecursive('.', { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log('No source files found in this project.');
    return;
  }

  const folders = summarizeRootFolders(files);

  if (folders.length === 0) {
    await selectFilesAtRoot(files);
    return;
  }

  const maxNameLength = Math.max(...folders.map((folder) => folder.name.length + 1));

  const folderChoices = folders.map((folder) => ({
    name: `${folder.name}/`.padEnd(maxNameLength + 2) + `(${folder.fileCount} arquivo${folder.fileCount === 1 ? '' : 's'})`,
    value: folder.name,
  }));

  const choice = await select<string>('Qual pasta quer documentar?', [
    ...folderChoices,
    { name: 'Arquivo específico', value: SPECIFIC_FILE_OPTION },
    { name: 'Projeto inteiro', value: WHOLE_PROJECT_OPTION },
  ]);

  if (choice === WHOLE_PROJECT_OPTION) {
    await runDocAll(false);
    return;
  }

  if (choice === SPECIFIC_FILE_OPTION) {
    const manualPath = await input('Caminho do arquivo:');
    await documentTargetPath(manualPath);
    return;
  }

  await selectFilesInFolder(choice);
}

export async function runDocCode(target: string | undefined, options: RunDocCodeOptions = {}): Promise<void> {
  if (options.all) {
    await runDocAll(options.force ?? false);
    return;
  }

  if (target) {
    await documentTargetPath(target);
    return;
  }

  await runInteractiveSelection();
}
