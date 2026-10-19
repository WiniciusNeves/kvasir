import axios from 'axios';
import { listInstalledModels } from '@ai/ollama';
import { runCommand, commandSucceeded } from '@utils/process';

// Embeddings for OmniContext, always local (Ollama): the text is the user's code and notes.
// nomic-embed-text expects a task prefix: "search_document: " for what is indexed and
// "search_query: " for the question; without it the retrieval quality drops.

export const EMBEDDING_MODEL = 'nomic-embed-text';
const OLLAMA_URL = 'http://localhost:11434';
const BATCH_SIZE = 32;
const TIMEOUT_MS = 120_000;

interface EmbedResponse {
  embeddings?: number[][];
}

function matches(name: string, model: string): boolean {
  return name === model || name.startsWith(`${model}:`);
}

export async function hasEmbeddingModel(model: string = EMBEDDING_MODEL): Promise<boolean> {
  return (await listInstalledModels()).some((name) => matches(name, model));
}

// `ollama pull` with the progress shown to the user (the caller asks first).
export function pullEmbeddingModel(model: string = EMBEDDING_MODEL): boolean {
  return commandSucceeded(runCommand('ollama', ['pull', model], { inherit: true }));
}

async function embedBatch(inputs: string[], model: string): Promise<number[][]> {
  try {
    const response = await axios.post<EmbedResponse>(`${OLLAMA_URL}/api/embed`, { model, input: inputs, truncate: true }, { timeout: TIMEOUT_MS });
    const embeddings = response.data.embeddings ?? [];
    if (embeddings.length !== inputs.length) throw new Error(`o Ollama devolveu ${embeddings.length} de ${inputs.length} vetores`);
    return embeddings;
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (status === 404) throw new Error(`Modelo de embeddings "${model}" não encontrado no Ollama. Rode "ollama pull ${model}".`);
    if ((error as { code?: string }).code === 'ECONNREFUSED') throw new Error('Não foi possível conectar ao Ollama em http://localhost:11434. Verifique se o Ollama está rodando.');
    throw error;
  }
}

export async function embedDocuments(texts: string[], onProgress?: (done: number) => void, model: string = EMBEDDING_MODEL): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE).map((text) => `search_document: ${text}`);
    vectors.push(...(await embedBatch(batch, model)));
    onProgress?.(vectors.length);
  }
  return vectors;
}

export async function embedQuery(text: string, model: string = EMBEDDING_MODEL): Promise<number[]> {
  return (await embedBatch([`search_query: ${text}`], model))[0];
}
