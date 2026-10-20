import path from 'path';
import { hasEmbeddingModel } from '@ai/embeddings';
import { getRepoRoot } from '@utils/git';
import { readUserConfig } from '@utils/userConfig';
import { indexFolder, hasIndex, search } from '@rag/index';

// Related code from the rest of the project for fix, watch, review and test prompts (OmniContext F2):
// small models invent less when they see the real definition of a type or a function. Optional by
// design: no index, no embedding model, Ollama down or `rag.context: false` → empty string, never an error.

export interface CodeRange {
  file: string;
  startLine: number;
  endLine: number;
}

export interface RelatedContextOptions {
  // what the prompt already shows (the snippet around the error, the file under test): not repeated
  exclude?: CodeRange[];
  // files the prompt already has entirely
  excludeFiles?: string[];
  limit?: number;
}

const DEFAULT_LIMIT = 4;
const MAX_LINES_PER_PIECE = 30;
const REFRESH_EVERY_MS = 30_000;
const DOC_FILE = /\.(md|mdx|txt)$/i;

const lastRefresh = new Map<string, number>();
let embeddingModelPresent: boolean | null = null;

function normalizeFile(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function overlaps(piece: CodeRange, range: CodeRange): boolean {
  return normalizeFile(piece.file) === normalizeFile(range.file) && piece.startLine <= range.endLine && range.startLine <= piece.endLine;
}

// Keeps the index current without a watcher: re-embeds only what changed, at most every 30 s.
async function refresh(root: string): Promise<void> {
  const last = lastRefresh.get(root) ?? 0;
  if (Date.now() - last < REFRESH_EVERY_MS) return;
  lastRefresh.set(root, Date.now());
  await indexFolder(root, path.basename(root));
}

export async function relatedContext(query: string, options: RelatedContextOptions = {}): Promise<string> {
  try {
    if ((await readUserConfig()).rag?.context === false) return '';
    const root = getRepoRoot(process.cwd()) ?? process.cwd();
    if (!hasIndex(root)) return '';
    if (embeddingModelPresent === null) embeddingModelPresent = await hasEmbeddingModel();
    if (!embeddingModelPresent) return '';

    await refresh(root);
    const limit = options.limit ?? DEFAULT_LIMIT;
    const excludeFiles = new Set((options.excludeFiles ?? []).map(normalizeFile));
    const hits = (await search(query, [root], limit * 3))
      .filter((hit) => !DOC_FILE.test(hit.chunk.file))
      .filter((hit) => !excludeFiles.has(normalizeFile(hit.chunk.file)))
      .filter((hit) => !(options.exclude ?? []).some((range) => overlaps(hit.chunk, range)))
      .slice(0, limit);
    if (hits.length === 0) return '';

    const pieces = hits.map((hit) => {
      const lines = hit.chunk.text.split('\n').slice(0, MAX_LINES_PER_PIECE);
      const numbered = lines.map((line, offset) => `${String(hit.chunk.startLine + offset).padStart(4)} | ${line}`).join('\n');
      return `// ${hit.chunk.file} (linhas ${hit.chunk.startLine}-${hit.chunk.endLine})\n${numbered}`;
    });
    console.log(`🧠 Contexto do projeto: ${hits.map((hit) => `${hit.chunk.file}:${hit.chunk.startLine}`).join(', ')}`);
    return `Trechos de outros arquivos do projeto, achados pela busca (use só o que ajudar; não invente o que não está aqui):\n${pieces.join('\n\n')}\n`;
  } catch {
    return '';
  }
}
