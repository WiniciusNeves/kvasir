import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { readFile, writeFile, pathExists } from '@utils/fs';
import { input, select, confirm } from '@utils/prompt';
import type { KnowledgeCategory } from '@ktypes/knowledge';

function getKnowledgeDir(): string {
  return path.join(os.homedir(), '.kvasir', 'knowledge');
}

function getIndexPath(): string {
  return path.join(getKnowledgeDir(), 'index.md');
}

function getNotePath(category: KnowledgeCategory, title: string): string {
  const slug = title.trim().toLowerCase().replace(/\s+/g, '-');
  return path.join(getKnowledgeDir(), category, `${slug}.md`);
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  const exists = await fs.pathExists(dir);
  if (!exists) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function searchKnowledge(query: string): Promise<void> {
  const files = await walkMarkdownFiles(getKnowledgeDir());

  if (files.length === 0) {
    console.log('Knowledge base is empty. Use "kvasir knowledge add" to create your first note.');
    return;
  }

  const lowerQuery = query.toLowerCase();
  const matches: string[] = [];

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    if (content.toLowerCase().includes(lowerQuery) || file.toLowerCase().includes(lowerQuery)) {
      matches.push(path.relative(getKnowledgeDir(), file));
    }
  }

  if (matches.length === 0) {
    console.log(`No matches found for "${query}".`);
    return;
  }

  console.log(`\nMatches for "${query}":`);
  matches.forEach((match) => console.log(`  - ${match}`));
}

export async function addKnowledge(): Promise<void> {
  const category = await select<KnowledgeCategory>('Category:', [
    { name: 'Library docs', value: 'libs' },
    { name: 'Code pattern', value: 'patterns' },
    { name: 'Technical decision', value: 'decisions' },
    { name: 'Task history', value: 'tasks' },
    { name: 'Commit log', value: 'commits' },
  ]);

  const title = await input('Note title:');
  const content = await input('Note content:');

  const notePath = getNotePath(category, title);
  const body = `# ${title}\n\n${content}\n`;

  console.log(`\nThis will save a note to ${notePath}`);
  const approved = await confirm('Save this note?');
  if (!approved) {
    console.log('Note discarded.');
    return;
  }

  await writeFile(notePath, body);
  console.log(`Saved: ${notePath}`);
}

export async function linkKnowledge(): Promise<void> {
  const files = await walkMarkdownFiles(getKnowledgeDir());
  if (files.length < 2) {
    console.log('You need at least two notes to create a link.');
    return;
  }

  const relativeFiles = files.map((file) => path.relative(getKnowledgeDir(), file));

  const first = await select<string>(
    'Link from:',
    relativeFiles.map((file) => ({ name: file, value: file }))
  );
  const second = await select<string>(
    'Link to:',
    relativeFiles.filter((file) => file !== first).map((file) => ({ name: file, value: file }))
  );

  const approved = await confirm(`Link "${first}" <-> "${second}"?`);
  if (!approved) {
    console.log('Link cancelled.');
    return;
  }

  const firstPath = path.join(getKnowledgeDir(), first);
  const secondPath = path.join(getKnowledgeDir(), second);

  const firstNoteName = path.basename(first, '.md');
  const secondNoteName = path.basename(second, '.md');

  const firstContent = (await readFile(firstPath)) ?? '';
  const secondContent = (await readFile(secondPath)) ?? '';

  await writeFile(firstPath, `${firstContent}\n\nRelated: [[${secondNoteName}]]\n`);
  await writeFile(secondPath, `${secondContent}\n\nRelated: [[${firstNoteName}]]\n`);

  console.log('Notes linked.');
}

export async function showKnowledge(): Promise<void> {
  const indexExists = await pathExists(getIndexPath());

  if (indexExists) {
    const indexContent = await readFile(getIndexPath());
    console.log(indexContent);
    return;
  }

  const files = await walkMarkdownFiles(getKnowledgeDir());
  if (files.length === 0) {
    console.log('Knowledge base is empty.');
    return;
  }

  console.log('\nKnowledge base contents:');
  files.forEach((file) => console.log(`  - ${path.relative(getKnowledgeDir(), file)}`));
}
