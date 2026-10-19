import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { readFile, writeFile } from '@utils/fs';
import { KNOWLEDGE_CATEGORIES } from '@ktypes/knowledge';
import type { KnowledgeCategory, NoteMeta } from '@ktypes/knowledge';

// Single entry point for writing to ~/.kvasir/knowledge (an Obsidian vault): every note gets
// frontmatter, and index.md is rebuilt after each write.

export type SaveMode = 'append' | 'replace';

export interface SaveNoteInput {
  category: KnowledgeCategory;
  title: string;
  body: string;
  origin: string;
  tags?: string[];
  project?: string;
}

export interface StoredNote {
  meta: NoteMeta;
  body: string;
}

interface IndexedNote {
  slug: string;
  meta: NoteMeta;
}

const CATEGORY_TITLES: Record<KnowledgeCategory, string> = {
  libs: 'Bibliotecas',
  patterns: 'Padrões',
  decisions: 'Decisões',
  tasks: 'Tasks',
  commits: 'Commits',
  errors: 'Erros resolvidos',
  agents: 'Agentes',
  answers: 'Perguntas respondidas',
};

export function getKnowledgeDir(): string {
  return path.join(os.homedir(), '.kvasir', 'knowledge');
}

export function getIndexPath(): string {
  return path.join(getKnowledgeDir(), 'index.md');
}

// Titles like "Hooks / React Query: padrão" used to create a sub-folder ("/") and, on Windows,
// an NTFS alternate data stream (":"). Keep only [a-z0-9-].
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getNotePath(category: KnowledgeCategory, title: string): string {
  return path.join(getKnowledgeDir(), category, `${slugify(title)}.md`);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toTag(value: string): string {
  return slugify(value) || 'kvasir';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(meta: NoteMeta): string {
  return [
    '---',
    `title: ${yamlString(meta.title)}`,
    `tags: [${meta.tags.join(', ')}]`,
    `projetos: [${meta.projects.join(', ')}]`,
    `origem: ${yamlString(meta.origin)}`,
    `criado: ${meta.created}`,
    `atualizado: ${meta.updated}`,
    '---',
  ].join('\n');
}

function parseList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function parseScalar(value: string): string {
  return value
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// Reads the small YAML subset this module writes. Notes without frontmatter (older or hand-written)
// get defaults: title from the first heading or the file name.
export function parseNote(content: string, fallbackTitle: string): StoredNote {
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  const fields = new Map<string, string>();

  if (match) {
    for (const line of match[1].split('\n')) {
      const field = line.match(/^(\w+):\s*(.*)$/);
      if (field) fields.set(field[1], field[2]);
    }
  }

  let body = match ? normalized.slice(match[0].length) : normalized;
  const heading = body.match(/^\s*# (.+)\n?/);
  if (heading) body = body.slice(heading[0].length);

  const date = today();
  const title = fields.get('title');

  return {
    meta: {
      title: title !== undefined ? parseScalar(title) : heading?.[1].trim() ?? fallbackTitle,
      tags: parseList(fields.get('tags') ?? ''),
      projects: parseList(fields.get('projetos') ?? ''),
      origin: parseScalar(fields.get('origem') ?? 'manual'),
      created: fields.get('criado')?.trim() || date,
      updated: fields.get('atualizado')?.trim() || date,
    },
    body: body.replace(/^\n+/, ''),
  };
}

export async function readNote(category: KnowledgeCategory, title: string): Promise<StoredNote | null> {
  const content = await readFile(getNotePath(category, title));
  return content === null ? null : parseNote(content, title);
}

// append: adds `body` after the existing content (creating the note if needed) · replace: rewrites it.
// Tags and projects are merged, so a note used by several projects keeps all of them.
export async function saveNote(input: SaveNoteInput, mode: SaveMode): Promise<string> {
  const notePath = getNotePath(input.category, input.title);
  const existing = await readNote(input.category, input.title);
  const date = today();

  const meta: NoteMeta = {
    title: input.title,
    tags: unique(['kvasir', input.category, ...(existing?.meta.tags ?? []), ...(input.tags ?? []).map(toTag)]),
    projects: unique([...(existing?.meta.projects ?? []), input.project ? toTag(input.project) : '']),
    origin: existing?.meta.origin ?? input.origin,
    created: existing?.meta.created ?? date,
    updated: date,
  };

  const body = mode === 'append' && existing ? `${existing.body.trimEnd()}\n\n${input.body.trim()}` : input.body.trim();
  await writeFile(notePath, `${buildFrontmatter(meta)}\n\n# ${input.title}\n\n${body}\n`);
  await rebuildIndex();

  return path.relative(getKnowledgeDir(), notePath).split(path.sep).join('/');
}

async function listCategoryNotes(category: KnowledgeCategory): Promise<IndexedNote[]> {
  const dir = path.join(getKnowledgeDir(), category);
  if (!(await fs.pathExists(dir))) return [];

  const notes: IndexedNote[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const slug = entry.name.replace(/\.md$/, '');
    const content = await fs.readFile(path.join(dir, entry.name), 'utf-8');
    notes.push({ slug, meta: parseNote(content, slug).meta });
  }

  return notes.sort((a, b) => b.meta.updated.localeCompare(a.meta.updated) || a.slug.localeCompare(b.slug));
}

// index.md = the vault map: one section per folder, most recently updated first.
export async function rebuildIndex(): Promise<void> {
  const date = today();
  const sections: string[] = [];
  let total = 0;

  for (const category of KNOWLEDGE_CATEGORIES) {
    const notes = await listCategoryNotes(category);
    total += notes.length;
    const items = notes.map((note) => `- [[${category}/${note.slug}|${note.meta.title}]] · ${note.meta.updated}`);
    sections.push(`## ${CATEGORY_TITLES[category]} (${notes.length})\n\n${items.length > 0 ? items.join('\n') : '_vazio_'}`);
  }

  const frontmatter = buildFrontmatter({
    title: 'Kvasir knowledge',
    tags: ['kvasir', 'index'],
    projects: [],
    origin: 'kvasir (gerado automaticamente)',
    created: date,
    updated: date,
  });

  await writeFile(
    getIndexPath(),
    `${frontmatter}\n\n# Kvasir knowledge\n\n> Gerado automaticamente pelo Kvasir: não edite à mão. ${total} nota(s).\n\n${sections.join('\n\n')}\n`
  );
}

export interface VaultNote {
  category: KnowledgeCategory;
  slug: string;
  meta: NoteMeta;
  body: string;
}

// Every note of the vault with its body (stats, graph view).
export async function listAllNotes(): Promise<VaultNote[]> {
  const notes: VaultNote[] = [];
  for (const category of KNOWLEDGE_CATEGORIES) {
    const dir = path.join(getKnowledgeDir(), category);
    if (!(await fs.pathExists(dir))) continue;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const slug = entry.name.replace(/\.md$/, '');
      const { meta, body } = parseNote(await fs.readFile(path.join(dir, entry.name), 'utf-8'), slug);
      notes.push({ category, slug, meta, body });
    }
  }
  return notes;
}
