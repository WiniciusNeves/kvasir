import axios from 'axios';

const OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'codellama';

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
}

export async function askOllama(prompt: string, options: AskOllamaOptions = {}): Promise<string> {
  const { model = DEFAULT_MODEL, maxTokens, timeoutMs } = options;

  const response = await axios.post<OllamaGenerateResponse>(
    `${OLLAMA_BASE_URL}/api/generate`,
    {
      model,
      prompt,
      stream: false,
      ...(maxTokens ? { options: { num_predict: maxTokens } } : {}),
    },
    timeoutMs ? { timeout: timeoutMs } : undefined
  );

  return response.data.response;
}

export async function listInstalledModels(): Promise<string[]> {
  const response = await axios.get<OllamaTagsResponse>(`${OLLAMA_BASE_URL}/api/tags`);
  return response.data.models.map((entry) => entry.name);
}
