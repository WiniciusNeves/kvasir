import axios from 'axios';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'codellama';
// Ollama's default context (2048–4096 tokens) silently drops the START of long prompts,
// which is exactly where the instructions are.
const DEFAULT_NUM_CTX = 8192;

interface OllamaGenerateResponse {
  response: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models: { name: string }[];
}

export interface AskOllamaOptions {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  temperature?: number;
  numCtx?: number;
  repeatPenalty?: number;
}

// Reasoning models (deepseek-r1) prefix the answer with a <think>…</think> block.
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export interface OllamaResult {
  text: string;
  promptTokens?: number;
  outputTokens?: number;
}

export async function askOllama(prompt: string, options: AskOllamaOptions = {}): Promise<string> {
  return (await askOllamaDetailed(prompt, options)).text;
}

// Same call, plus the token counts Ollama reports (used by the metrics).
export async function askOllamaDetailed(prompt: string, options: AskOllamaOptions = {}): Promise<OllamaResult> {
  const { model = DEFAULT_MODEL, maxTokens, timeoutMs, temperature, numCtx = DEFAULT_NUM_CTX, repeatPenalty } = options;

  const response = await axios.post<OllamaGenerateResponse>(
    `${OLLAMA_BASE_URL}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      options: {
        num_ctx: numCtx,
        ...(maxTokens ? { num_predict: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(repeatPenalty !== undefined ? { repeat_penalty: repeatPenalty } : {}),
      },
    },
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

  return {
    text: stripThinking(response.data.response),
    promptTokens: response.data.prompt_eval_count,
    outputTokens: response.data.eval_count,
  };
}

export async function listInstalledModels(): Promise<string[]> {
  const response = await axios.get<OllamaTagsResponse>(`${OLLAMA_BASE_URL}/api/tags`);
  return response.data.models.map((entry) => entry.name);
}
