import os from 'os';
import path from 'path';
import { appendLine, readFile } from '@utils/fs';
import { embedDocuments, embedQuery, hasEmbeddingModel } from '@ai/embeddings';

// The developer's own past answers, per task: what the AI suggested and what the developer kept.
// Local models copy the shape of an example far better than they follow a description of a taste
// ("short commits"), so the most similar past cases go into the prompt as examples.
// Stored in ~/.kvasir/examples/<task>.jsonl (personal, never in a repo); vectors are local
// (nomic-embed-text through Ollama). Without the embedding model the most recent cases are used.

export type ExampleDecision = 'approved' | 'edited' | 'rejected';
export type ExampleSource = 'kvasir' | 'git';

export interface Example {
  project: string;
  // what the case was about, in the same shape for recording and searching ("arquivos: …", the task text)
  input: string;
  // what the developer kept: the approved suggestion or the edited version
  output: string;
  // the AI's suggestion, when the developer changed it
  suggested?: string;
  decision: ExampleDecision;
  source: ExampleSource;
  timestamp: string;
  vector?: number[];
}

export interface NewExample {
  input: string;
  output: string;
  suggested?: string;
  decision: ExampleDecision;
  source?: ExampleSource;
  // when it happened (a commit from the history keeps its own date); default: now
  timestamp?: string;
}

const MAX_INPUT_CHARS = 1500;
const VECTOR_DECIMALS = 4;
// a project with fewer own examples than this borrows from the other projects
const MIN_PROJECT_EXAMPLES = 3;
// added to the similarity (0–1) for the newest case, scaled down to 0 for the oldest
const RECENCY_WEIGHT = 0.15;

const cache = new Map<string, Example[]>();

function examplesFile(task: string): string {
  return path.join(os.homedir(), '.kvasir', 'examples', `${task}.jsonl`);
}

export function currentProject(): string {
  return path.basename(process.cwd());
}

async function readExamples(task: string): Promise<Example[]> {
  const cached = cache.get(task);
  if (cached) return cached;
  const raw = (await readFile(examplesFile(task))) ?? '';
  const examples = raw
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Example];
      } catch {
        return [];
      }
    });
  cache.set(task, examples);
  return examples;
}

function round(vector: number[]): number[] {
  return vector.map((value) => Number(value.toFixed(VECTOR_DECIMALS)));
}

async function embedAll(inputs: string[]): Promise<(number[] | undefined)[]> {
  try {
    if (!(await hasEmbeddingModel())) return inputs.map(() => undefined);
    return (await embedDocuments(inputs)).map(round);
  } catch {
    return inputs.map(() => undefined);
  }
}

// Learning must never break a command: a failed write only loses one example.
async function store(task: string, examples: Example[]): Promise<void> {
  const current = await readExamples(task);
  for (const example of examples) {
    try {
      await appendLine(examplesFile(task), JSON.stringify(example));
      current.push(example);
    } catch {
      // ignore
    }
  }
}

export async function recordExample(task: string, example: NewExample): Promise<void> {
  const input = example.input.slice(0, MAX_INPUT_CHARS);
  if (!input.trim() || !example.output.trim()) return;
  const [vector] = await embedAll([input]);
  await store(task, [{ ...example, input, source: example.source ?? 'kvasir', project: currentProject(), timestamp: example.timestamp ?? new Date().toISOString(), vector }]);
}

// Several at once (seeding from the git history): one embedding batch, duplicates of what is stored skipped.
export async function recordExamples(task: string, examples: NewExample[]): Promise<number> {
  const project = currentProject();
  const known = new Set((await readExamples(task)).filter((item) => item.project === project).map((item) => item.output));
  const fresh = examples.filter((item) => item.input.trim() && item.output.trim() && !known.has(item.output));
  if (fresh.length === 0) return 0;

  const inputs = fresh.map((item) => item.input.slice(0, MAX_INPUT_CHARS));
  const vectors = await embedAll(inputs);
  const now = new Date().toISOString();
  await store(
    task,
    fresh.map((item, index) => ({ ...item, input: inputs[index], source: item.source ?? 'kvasir', project, timestamp: item.timestamp ?? now, vector: vectors[index] }))
  );
  return fresh.length;
}

export async function countExamples(task: string, source?: ExampleSource): Promise<number> {
  const project = currentProject();
  return (await readExamples(task)).filter((item) => item.project === project && (!source || item.source === source)).length;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

// What the developer wanted (approved or edited), from this project when it has enough, most similar first.
export async function findExamples(task: string, query: string, limit: number): Promise<Example[]> {
  const project = currentProject();
  const wanted = (await readExamples(task)).filter((item) => item.decision !== 'rejected');
  const own = wanted.filter((item) => item.project === project);
  const pool = own.length >= MIN_PROJECT_EXAMPLES ? own : wanted;
  if (pool.length === 0) return [];

  let queryVector: number[] | null = null;
  if (pool.some((item) => item.vector)) {
    try {
      queryVector = (await hasEmbeddingModel()) ? await embedQuery(query.slice(0, MAX_INPUT_CHARS)) : null;
    } catch {
      queryVector = null;
    }
  }

  // Styles change over time: the newest cases weigh more, and recency is the whole order without vectors.
  const byAge = [...pool].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const recency = new Map(byAge.map((item, index) => [item, byAge.length > 1 ? index / (byAge.length - 1) : 1]));
  const scored = pool.map((item) => ({
    item,
    score: (queryVector && item.vector ? cosine(queryVector, item.vector) : 0) + RECENCY_WEIGHT * (recency.get(item) ?? 0),
  }));
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
    .filter((item) => (seen.has(item.output) ? false : (seen.add(item.output), true)))
    .slice(0, limit);
}
