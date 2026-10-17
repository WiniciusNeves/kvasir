import axios from 'axios';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'codellama';
// Ollama's default context (2048–4096 tokens) silently drops the START of long prompts,
// which is exactly where the instructions are.
const DEFAULT_NUM_CTX = 8192;

interface OllamaGenerateResponse {
  response: string;
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

export async function askOllama(prompt: string, options: AskOllamaOptions = {}): Promise<string> {
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

  return stripThinking(response.data.response);
}

export async function listInstalledModels(): Promise<string[]> {
  const response = await axios.get<OllamaTagsResponse>(`${OLLAMA_BASE_URL}/api/tags`);
  return response.data.models.map((entry) => entry.name);
}
