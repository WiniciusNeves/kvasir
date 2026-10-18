import path from 'path';
import fs from 'fs-extra';
import { readClipboard } from '@ai/client';
import { readFile, writeFile, pathExists } from '@utils/fs';
import { getKnowledgeDir, getIndexPath, getNotePath, slugify, saveNote, rebuildIndex } from './notes';
import { input, select, confirm } from '@utils/prompt';
import type { KnowledgeCategory } from '@ktypes/knowledge';

type ContentSource = 'type' | 'clipboard';

const MAX_SNIPPET = 100;

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const exists = await fs.pathExists(dir);
  if (!exists) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.name.endsWith('.md') && fullPath !== getIndexPath()) {
      files.push(fullPath);
    }
  }

  return files;
}

function relativeNote(file: string): string {
  return path.relative(getKnowledgeDir(), file).split(path.sep).join('/');
}

async function offerFirstNote(): Promise<void> {
  console.log('A base de conhecimento ainda está vazia (fix, commit, review e doc criam notas sozinhos).');
  if (await confirm('Criar a primeira nota agora (kvasir knowledge add)?')) await addKnowledge();
}

export async function searchKnowledge(query: string): Promise<void> {
  const files = await walkMarkdownFiles(getKnowledgeDir());

  if (files.length === 0) {
    await offerFirstNote();
    return;
  }

  const lowerQuery = query.toLowerCase();
  let matchCount = 0;

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const matchingLine = content.split(/\r?\n/).find((line) => line.toLowerCase().includes(lowerQuery));
    const nameMatches = relativeNote(file).toLowerCase().includes(lowerQuery);
    if (!matchingLine && !nameMatches) continue;

    matchCount += 1;
    console.log(`\n  ${relativeNote(file)}`);
    if (matchingLine) console.log(`    ${matchingLine.trim().slice(0, MAX_SNIPPET)}`);
  }

  console.log(matchCount === 0 ? `Nada encontrado para "${query}".` : `\n${matchCount} nota(s) encontrada(s).`);
}

// `input()` is single-line: multi-line notes come from the clipboard.
async function readNoteContent(): Promise<string> {
  const source = await select<ContentSource>('Conteúdo da nota:', [
    { name: 'Digitar (uma linha)', value: 'type' },
    { name: 'Ler do clipboard (várias linhas)', value: 'clipboard' },
  ]);

  if (source === 'type') return input('Conteúdo:');

  const content = (await readClipboard()).trim();
  if (!content) throw new Error('O clipboard está vazio. Copie o conteúdo da nota e tente de novo.');
  return content;
}

export async function addKnowledge(): Promise<void> {
  const category = await select<KnowledgeCategory>('Categoria:', [
    { name: 'Documentação de lib', value: 'libs' },
    { name: 'Padrão de código', value: 'patterns' },
    { name: 'Decisão técnica', value: 'decisions' },
    { name: 'Histórico de task', value: 'tasks' },
    { name: 'Histórico de commits', value: 'commits' },
    { name: 'Erro resolvido', value: 'errors' },
  ]);

  const title = (await input('Título da nota:')).trim();
  if (!slugify(title)) {
    console.log('Título vazio. Nota descartada.');
    return;
  }

  const content = await readNoteContent();
  const notePath = getNotePath(category, title);
  const exists = await pathExists(notePath);

  console.log(`\n${exists ? '⚠️  Já existe uma nota em' : 'A nota será salva em'} ${notePath}`);
  const approved = await confirm(exists ? 'Substituir a nota existente?' : 'Salvar esta nota?');
  if (!approved) {
    console.log('Nota descartada.');
    return;
  }

  const saved = await saveNote({ category, title, body: content, origin: 'manual (kvasir knowledge add)', project: path.basename(process.cwd()) }, 'replace');
  console.log(`✅ Salva: ${saved}`);
}

function appendRelated(content: string, noteName: string): string {
  const link = `[[${noteName}]]`;
  if (content.includes(link)) return content;
  return `${content.trimEnd()}\n\nRelacionado: ${link}\n`;
}

export async function linkKnowledge(): Promise<void> {
  const files = await walkMarkdownFiles(getKnowledgeDir());
  if (files.length < 2) {
    console.log('São necessárias pelo menos duas notas para criar um link.');
    return;
  }

  const relativeFiles = files.map(relativeNote);

  const first = await select<string>(
    'Ligar a nota:',
    relativeFiles.map((file) => ({ name: file, value: file }))
  );
  const second = await select<string>(
    'Com a nota:',
    relativeFiles.filter((file) => file !== first).map((file) => ({ name: file, value: file }))
  );

  const approved = await confirm(`Ligar "${first}" <-> "${second}"?`);
  if (!approved) {
    console.log('Link cancelado.');
    return;
  }

  const firstPath = path.join(getKnowledgeDir(), first);
  const secondPath = path.join(getKnowledgeDir(), second);

  const firstContent = (await readFile(firstPath)) ?? '';
  const secondContent = (await readFile(secondPath)) ?? '';

  await writeFile(firstPath, appendRelated(firstContent, path.basename(second, '.md')));
  await writeFile(secondPath, appendRelated(secondContent, path.basename(first, '.md')));

  console.log('✅ Notas ligadas.');
}

// index.md is generated: rebuild it (notes may have been edited in Obsidian) and print it.
export async function showKnowledge(): Promise<void> {
  const files = await walkMarkdownFiles(getKnowledgeDir());
  if (files.length === 0) {
    await offerFirstNote();
    return;
  }

  await rebuildIndex();
  console.log((await readFile(getIndexPath())) ?? '');
  console.log(`Vault do Obsidian: ${getKnowledgeDir()}`);
}
