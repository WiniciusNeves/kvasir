import os from 'os';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { embedDocuments, embedQuery, EMBEDDING_MODEL } from '@ai/embeddings';
import { chunkFile, embeddingText } from './chunker';
import type { Chunk } from './chunker';
import { listIndexableFiles, readWithoutSecrets } from './files';
import { buildKeywordIndex } from './keyword';
import { FileStore, indexesDir, indexIdFor } from './store';
import type { VectorStore, IndexMeta } from './store';

// OmniContext (local RAG): index(folder) and search(question). Isolated module with its own interface
// so it can become a separate package later (Doc/ideas/omnicontext.md).

const EMBEDDING_DIMS = 768;
const CANDIDATES = 40;
// reciprocal rank fusion: the usual constant
const RRF_K = 60;

export interface IndexProgress {
  phase: 'scan' | 'embed' | 'save';
  done: number;
  total: number;
}

export interface IndexReport {
  name: string;
  root: string;
  files: number;
  chunks: number;
  added: number;
  changed: number;
  removed: number;
  // the embedding model changed since the last run: everything was rebuilt
  rebuilt: boolean;
}

export interface SearchHit {
  chunk: Chunk;
  index: string;
  root: string;
  score: number;
}

export function knowledgeRoot(): string {
  return path.join(os.homedir(), '.kvasir', 'knowledge');
}

function storeDir(root: string): string {
  return path.join(indexesDir(), indexIdFor(root));
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function openOrCreate(root: string, name: string): { store: FileStore; rebuilt: boolean } {
  const dir = storeDir(root);
  if (FileStore.exists(dir)) {
    const store = FileStore.open(dir);
    // vectors from another model (or another machine's model) cannot be compared: start over
    if (store.meta.model === EMBEDDING_MODEL && store.meta.dims === EMBEDDING_DIMS) return { store, rebuilt: false };
  }
  return { store: FileStore.create(dir, { name, root: path.resolve(root), model: EMBEDDING_MODEL, dims: EMBEDDING_DIMS }), rebuilt: FileStore.exists(dir) };
}

// Incremental: only new or changed files (by content hash) are embedded again.
export async function indexFolder(root: string, name: string, onProgress?: (progress: IndexProgress) => void): Promise<IndexReport> {
  const { store, rebuilt } = openOrCreate(root, name);
  const files = listIndexableFiles(root);
  onProgress?.({ phase: 'scan', done: files.length, total: files.length });

  const current = new Map<string, { hash: string; text: string }>();
  for (const file of files) {
    const text = readWithoutSecrets(root, file);
    current.set(file, { hash: hashText(text), text });
  }

  const previous = store.meta.files;
  const removed = Object.keys(previous).filter((file) => !current.has(file));
  const changed = files.filter((file) => previous[file] && previous[file].hash !== current.get(file)?.hash);
  const added = files.filter((file) => !previous[file]);

  const toEmbed = [...changed, ...added].flatMap((file) => chunkFile(file, current.get(file)?.text ?? ''));
  const vectors = await embedDocuments(toEmbed.map(embeddingText), (done) => onProgress?.({ phase: 'embed', done, total: toEmbed.length }));

  store.replaceFiles([...removed, ...changed], toEmbed.map((chunk, index) => ({ chunk, vector: vectors[index] })));
  const fileHashes: IndexMeta['files'] = {};
  for (const [file, value] of current) fileHashes[file] = { hash: value.hash };
  store.meta.files = fileHashes;
  onProgress?.({ phase: 'save', done: 1, total: 1 });
  store.save();

  return { name, root: path.resolve(root), files: files.length, chunks: store.chunks.length, added: added.length, changed: changed.length, removed: removed.length, rebuilt };
}

export function hasIndex(root: string): boolean {
  return FileStore.exists(storeDir(root));
}

export function listIndexes(): IndexMeta[] {
  const dir = indexesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((entry) => FileStore.exists(path.join(dir, entry)))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(dir, entry, 'meta.json'), 'utf-8')) as IndexMeta);
}

export interface SearchOptions {
  // extra search terms (the question rewritten in the code's vocabulary): used by both sides
  expansion?: string;
}

const DOC_FILE = /.(md|mdx|txt)$/i;

// Docs in the user's language outrank English code for a Portuguese question: keep room for both.
function balance(ranked: SearchHit[], limit: number): SearchHit[] {
  const isDoc = (hit: SearchHit): boolean => hit.index === 'knowledge' || DOC_FILE.test(hit.chunk.file);
  const codeSlots = Math.ceil(limit * 0.6);
  const code = ranked.filter((hit) => !isDoc(hit)).slice(0, codeSlots);
  const docs = ranked.filter(isDoc).slice(0, limit - code.length);
  const picked = new Set([...code, ...docs]);
  // one side short: fill with the best of the rest, keeping the fused order
  for (const hit of ranked) if (picked.size < limit) picked.add(hit);
  return ranked.filter((hit) => picked.has(hit));
}

// Hybrid: meaning (vectors) + exact words (BM25), fused by rank, across the given folders' indexes.
export async function search(question: string, roots: string[], limit: number, options: SearchOptions = {}): Promise<SearchHit[]> {
  const stores: VectorStore[] = roots.filter(hasIndex).map((root) => FileStore.open(storeDir(root)));
  if (stores.length === 0) return [];

  const text = options.expansion ? `${question}
${options.expansion}` : question;
  const query = await embedQuery(text);
  const fused = new Map<string, SearchHit & { rrf: number }>();

  for (const store of stores) {
    const add = (ranked: { index: number }[]): void => {
      ranked.forEach(({ index }, rank) => {
        const key = `${store.meta.root}|${index}`;
        const entry = fused.get(key) ?? { chunk: store.chunks[index], index: store.meta.name, root: store.meta.root, score: 0, rrf: 0 };
        entry.rrf += 1 / (RRF_K + rank + 1);
        fused.set(key, entry);
      });
    };
    add(store.searchVector(query, CANDIDATES));
    add(buildKeywordIndex(store.chunks.map((chunk) => `${chunk.file} ${chunk.text}`)).search(text, CANDIDATES));
  }

  const ranked = [...fused.values()].sort((a, b) => b.rrf - a.rrf).map(({ rrf, ...hit }) => ({ ...hit, score: rrf }));
  return balance(ranked, limit);
}
