import os from 'os';
import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import type { Chunk } from './chunker';

// Where the vectors live. The built-in store needs nothing installed: normalized vectors quantized
// to int8 in one binary file (768 dims → 768 bytes per piece) + the pieces in JSON. Brute-force search
// measured at ~16 ms for 20k pieces and ~145 ms for 200k on this machine. Another backend (a Qdrant
// server for a shared index) only has to implement VectorStore.

export interface IndexMeta {
  version: 1;
  name: string;
  root: string;
  model: string;
  dims: number;
  updatedAt: string;
  files: Record<string, { hash: string }>;
}

export interface ScoredIndex {
  index: number;
  score: number;
}

export interface VectorStore {
  readonly meta: IndexMeta;
  readonly chunks: readonly Chunk[];
  replaceFiles(files: string[], added: { chunk: Chunk; vector: number[] }[]): void;
  searchVector(query: number[], limit: number): ScoredIndex[];
  save(): void;
}

const FORMAT_VERSION = 1;

export function indexesDir(): string {
  return path.join(os.homedir(), '.kvasir', 'index');
}

// One index per folder: readable name + hash of the absolute path (two "app" folders don't collide).
export function indexIdFor(root: string): string {
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'pasta';
  const hash = createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 8);
  return `${name}-${hash}`;
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

function quantize(vector: number[], dims: number): Int8Array {
  const normalized = normalize(vector);
  const out = new Int8Array(dims);
  for (let k = 0; k < dims; k += 1) out[k] = Math.max(-127, Math.min(127, Math.round((normalized[k] ?? 0) * 127)));
  return out;
}

export class FileStore implements VectorStore {
  meta: IndexMeta;
  chunks: Chunk[];
  private vectors: Int8Array;

  private constructor(private readonly dir: string, meta: IndexMeta, chunks: Chunk[], vectors: Int8Array) {
    this.meta = meta;
    this.chunks = chunks;
    this.vectors = vectors;
  }

  static exists(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'meta.json'));
  }

  static open(dir: string): FileStore {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf-8')) as IndexMeta;
    const chunks = JSON.parse(fs.readFileSync(path.join(dir, 'chunks.json'), 'utf-8')) as Chunk[];
    const buffer = fs.readFileSync(path.join(dir, 'vectors.bin'));
    const vectors = new Int8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    return new FileStore(dir, meta, chunks, vectors);
  }

  static create(dir: string, meta: Omit<IndexMeta, 'version' | 'files' | 'updatedAt'>): FileStore {
    return new FileStore(dir, { ...meta, version: FORMAT_VERSION, files: {}, updatedAt: new Date().toISOString() }, [], new Int8Array(0));
  }

  // Drops every piece of `files` and appends the new pieces (a changed file is removed and re-added).
  replaceFiles(files: string[], added: { chunk: Chunk; vector: number[] }[]): void {
    const drop = new Set(files);
    const dims = this.meta.dims;
    const keep = this.chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) => !drop.has(chunk.file));

    const vectors = new Int8Array((keep.length + added.length) * dims);
    keep.forEach(({ index }, position) => vectors.set(this.vectors.subarray(index * dims, (index + 1) * dims), position * dims));
    added.forEach(({ vector }, position) => vectors.set(quantize(vector, dims), (keep.length + position) * dims));

    this.chunks = [...keep.map(({ chunk }) => chunk), ...added.map(({ chunk }) => chunk)];
    this.vectors = vectors;
  }

  searchVector(query: number[], limit: number): ScoredIndex[] {
    const dims = this.meta.dims;
    const q = normalize(query);
    const best: ScoredIndex[] = [];
    for (let row = 0; row < this.chunks.length; row += 1) {
      let sum = 0;
      const offset = row * dims;
      for (let k = 0; k < dims; k += 1) sum += this.vectors[offset + k] * q[k];
      const score = sum / 127;
      if (best.length < limit || score > best[best.length - 1].score) {
        best.push({ index: row, score });
        best.sort((a, b) => b.score - a.score);
        if (best.length > limit) best.pop();
      }
    }
    return best;
  }

  save(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    this.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(this.dir, 'chunks.json'), JSON.stringify(this.chunks));
    fs.writeFileSync(path.join(this.dir, 'vectors.bin'), Buffer.from(this.vectors.buffer, this.vectors.byteOffset, this.vectors.byteLength));
    fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2));
  }
}
