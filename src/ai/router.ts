import { askOllama, listInstalledModels } from '@ai/ollama';
import { promptAI } from '@ai/client';
import { readFile } from '@utils/fs';

export type AiTask = 'commit' | 'branch' | 'fix' | 'review' | 'doc' | 'architect';

export const MODEL_MAP: Record<AiTask, string[]> = {
  commit: ['qwen2.5-coder', 'codellama'],
  branch: ['qwen2.5-coder', 'codellama'],
  fix: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  review: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  doc: ['llama3.2', 'qwen2.5-coder'],
  architect: ['deepseek-r1', 'llama3.2'],
};

// 30s was not enough for a cold model load or deepseek-r1 thinking: the chosen model timed out
// and a weaker fallback answered silently instead.
const REQUEST_TIMEOUT_MS = 120_000;
const CONTEXT_FILE = 'kvasir.context.md';

export interface AskForOptions {
  maxTokens?: number;
  temperature?: number;
}

async function getProjectArchitecture(): Promise<string> {
  const content = await readFile(CONTEXT_FILE);
  return content ?? '(kvasir.context.md não encontrado — rode "kvasir init")';
}

function buildOrchestratorPrompt(task: AiTask, prompt: string, architecture: string, models: string[]): string {
  return `Você é o orquestrador. Analise e decida qual modelo local usar. Depois valide o resultado antes de retornar.

Tarefa: ${task}

Arquitetura do projeto (kvasir.context.md):
${architecture}

Modelos locais disponíveis via Ollama para esta tarefa: ${models.join(', ')}

Analise a tarefa e o prompt abaixo e decida qual desses modelos é o mais adequado para executá-la.

Responda APENAS com uma linha no formato:
MODELO: <nome-do-modelo>

Tarefa/erro e prompt que será enviado ao modelo escolhido:
${prompt}`;
}

function buildValidationPrompt(task: AiTask, prompt: string, model: string, result: string): string {
  return `Você é o orquestrador, validando o resultado de um modelo local antes de retorná-lo.

Tarefa: ${task}
Modelo executor: ${model}

Prompt original enviado ao modelo:
${prompt}

Resultado retornado pelo modelo:
${result}

Valide se o resultado está correto e completo para a tarefa. Se estiver correto, responda com o resultado final. Se houver problemas, corrija e responda apenas com o resultado final já corrigido. Responda APENAS com o resultado final, sem explicações sobre a validação.`;
}

function matchesModel(name: string, model: string): boolean {
  return name === model || name.startsWith(`${model}:`) || model.startsWith(`${name}:`);
}

function extractChosenModel(decision: string, models: string[]): string {
  const match = decision.match(/MODELO:\s*(\S+)/i);
  const chosen = match ? match[1].replace(/[`'"*]/g, '').trim() : null;

  if (chosen) {
    const known = models.find((model) => matchesModel(chosen, model));
    if (known) return known;
  }

  return models[0];
}

// MODEL_MAP uses bare names ("qwen2.5-coder"), which Ollama only resolves to ":latest".
// A model installed as "qwen2.5-coder:7b" returned 404 and the router fell back silently.
async function resolveInstalledModels(task: AiTask): Promise<string[]> {
  let installed: string[];
  try {
    installed = await listInstalledModels();
  } catch {
    throw new Error('Não foi possível conectar ao Ollama em http://localhost:11434. Verifique se o Ollama está rodando.');
  }

  const resolved = MODEL_MAP[task]
    .map((model) => installed.find((name) => matchesModel(name, model)))
    .filter((name): name is string => name !== undefined);

  if (resolved.length === 0) {
    throw new Error(
      `Nenhum modelo para "${task}" está instalado no Ollama (${MODEL_MAP[task].join(', ')}). Rode "ollama pull ${MODEL_MAP[task][0]}".`
    );
  }

  return resolved;
}

async function runWithFallback(
  task: AiTask,
  models: string[],
  prompt: string,
  options: AskForOptions,
  onResult: (model: string, result: string) => Promise<string>
): Promise<string> {
  const failures: string[] = [];

  for (const model of models) {
    let result: string;
    try {
      result = await askOllama(prompt, { ...options, model, timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⚠️  ${model} falhou (${message}). Tentando o próximo modelo...`);
      failures.push(`${model}: ${message}`);
      continue;
    }
    return onResult(model, result);
  }

  throw new Error(
    `Nenhum modelo respondeu para a tarefa "${task}".\n${failures.map((line) => `  - ${line}`).join('\n')}`
  );
}

export async function askFor(task: AiTask, prompt: string, options: AskForOptions = {}): Promise<string> {
  const models = await resolveInstalledModels(task);

  const architecture = await getProjectArchitecture();
  const decision = await promptAI(buildOrchestratorPrompt(task, prompt, architecture, models));
  const chosenModel = extractChosenModel(decision, models);
  const orderedModels = [chosenModel, ...models.filter((model) => model !== chosenModel)];

  return runWithFallback(task, orderedModels, prompt, options, (model, result) =>
    promptAI(buildValidationPrompt(task, prompt, model, result))
  );
}

// Batch / fast path: first installed model of MODEL_MAP[task], no clipboard round trips.
export async function askLocal(task: AiTask, prompt: string, options: AskForOptions = {}): Promise<string> {
  const models = await resolveInstalledModels(task);
  return runWithFallback(task, models, prompt, options, async (_model, result) => result);
}
