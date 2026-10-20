import { projectDocsDir } from './folder';
import path from 'path';
import { askLocal } from '@ai/router';
import { queueJobs, clearQueuedJobs } from '@ai/jobs';
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
  return `${projectDocsDir()}/code/${withoutExt}.md`;
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

  // Agent Board: the files still to document show as "a fazer" for the Documentador.
  const pending: string[] = [];
  for (const file of files) if (force || !(await pathExists(toDocOutputPath(file)))) pending.push(file);
  queueJobs('doc', pending);

  try {
    for (let index = 0; index < total; index += 1) {
      const file = files[index];
      const position = index + 1;

      if (!pending.includes(file)) {
        console.log(`Documentando ${position}/${total} — ${file} (já existe, pulando)`);
        continue;
      }

      console.log(`Documentando ${position}/${total} — ${file}`);
      await documentFile(file);
    }
  } finally {
    clearQueuedJobs('doc');
  }

  console.log(`\nConcluído: ${total} arquivo(s) processado(s).`);
}

async function documentSingleFile(relativeFilePath: string): Promise<void> {
  const outputPath = toDocOutputPath(relativeFilePath);

  console.log(`\nVou documentar ${relativeFilePath} → ${outputPath}`);
  const approved = await confirm(`Documentar ${relativeFilePath}?`);
  if (!approved) {
    console.log('Pulado.');
    return;
  }

  await documentFile(relativeFilePath);
  console.log(`Salvo: ${outputPath}`);
}

async function documentFolder(relativeDirPath: string): Promise<void> {
  const files = await listFilesRecursive(relativeDirPath, { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log(`Nenhum arquivo de código em ${relativeDirPath}`);
    return;
  }

  console.log(`\nEncontrei ${files.length} arquivo(s) em ${relativeDirPath}:`);
  files.forEach((file) => console.log(`  - ${file}`));

  for (const file of files) {
    const relativeFilePath = toRelativePosixPath(path.join(relativeDirPath, file));
    const approved = await confirm(`Documentar ${relativeFilePath}?`);
    if (!approved) {
      console.log(`Pulado: ${relativeFilePath}`);
      continue;
    }

    await documentFile(relativeFilePath);
    console.log(`Salvo: ${toDocOutputPath(relativeFilePath)}`);
  }
}

async function documentTargetPath(target: string): Promise<void> {
  const exists = await pathExists(target);
  if (!exists) {
    console.log(`Caminho não encontrado: ${target}`);
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
    console.log('Nenhum arquivo de código neste projeto.');
    return;
  }

  console.log(`\nVou documentar ${files.length} arquivo(s) do projeto inteiro.`);
  const approved = await confirm('Continuar?');
  if (!approved) {
    console.log('Cancelado.');
    return;
  }

  await processFilesWithProgress(files, force);
}

async function selectFilesInFolder(folderName: string): Promise<void> {
  const files = await listFilesRecursive(folderName, { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log(`Nenhum arquivo de código em ${folderName}/`);
    return;
  }

  const selected = await checkbox<string>(
    `Selecione os arquivos de ${folderName}/:`,
    files.map((file) => ({ name: file, value: file }))
  );

  if (selected.length === 0) {
    console.log('Nenhum arquivo selecionado.');
    return;
  }

  const relativeSelected = selected.map((file) => toRelativePosixPath(path.join(folderName, file)));

  console.log('\nArquivos selecionados:');
  relativeSelected.forEach((file) => console.log(`  - ${file}`));

  const approved = await confirm(`Documentar estes ${relativeSelected.length} arquivo(s)?`);
  if (!approved) {
    console.log('Cancelado.');
    return;
  }

  await processFilesWithProgress(relativeSelected, true);
}

async function selectFilesAtRoot(files: string[]): Promise<void> {
  console.log(`\nEncontrei ${files.length} arquivo(s) de código na raiz do projeto.`);

  const selected = await checkbox<string>(
    'Selecione os arquivos para documentar:',
    files.map((file) => ({ name: file, value: file }))
  );

  if (selected.length === 0) {
    console.log('Nenhum arquivo selecionado.');
    return;
  }

  const approved = await confirm(`Documentar estes ${selected.length} arquivo(s)?`);
  if (!approved) {
    console.log('Cancelado.');
    return;
  }

  await processFilesWithProgress(selected, true);
}

async function runInteractiveSelection(): Promise<void> {
  const files = await listFilesRecursive('.', { extensions: CODE_EXTENSIONS });

  if (files.length === 0) {
    console.log('Nenhum arquivo de código neste projeto.');
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
