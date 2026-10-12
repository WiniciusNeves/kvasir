import { askOllama } from '@ai/ollama';

export type AiTask = 'commit' | 'branch' | 'fix' | 'review' | 'doc' | 'architect';

export const MODEL_MAP: Record<AiTask, string[]> = {
  commit: ['codellama', 'qwen2.5-coder'],
  branch: ['codellama', 'qwen2.5-coder'],
  fix: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  review: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  doc: ['llama3.2', 'qwen2.5-coder'],
  architect: ['deepseek-r1', 'llama3.2'],
};

const REQUEST_TIMEOUT_MS = 30_000;

export interface AskForOptions {
  maxTokens?: number;
}

export async function askFor(task: AiTask, prompt: string, options: AskForOptions = {}): Promise<string> {
  const { maxTokens } = options;
  const models = MODEL_MAP[task];
  const failures: string[] = [];

  for (const model of models) {
    try {
      return await askOllama(prompt, { model, maxTokens, timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${message}`);
    }
  }

  throw new Error(
    `Nenhum modelo respondeu para a tarefa "${task}".\n${failures.map((line) => `  - ${line}`).join('\n')}`
  );
}
