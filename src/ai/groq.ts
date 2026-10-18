import axios from 'axios';
import { describeHttpError } from '@ai/providers';
import { readSavedUserEnv } from '@utils/userEnv';
import type { ProviderCallOptions, ProviderResult } from '@ai/providers';

// Groq (OpenAI-compatible API, free tier, fast). Key from the environment only.
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function getGroqApiKey(): string | null {
  return process.env.GROQ_API_KEY || process.env.KVASIR_GROQ_API_KEY || readSavedUserEnv('GROQ_API_KEY');
}

// KVASIR_GROQ_BASE_URL: proxy or local mock (tests).
function baseUrl(): string {
  return (process.env.KVASIR_GROQ_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export async function askGroq(prompt: string, options: ProviderCallOptions): Promise<ProviderResult> {
  const key = getGroqApiKey();
  if (!key) throw new Error('GROQ_API_KEY não definida');

  try {
    const response = await axios.post<GroqResponse>(
      `${baseUrl()}/chat/completions`,
      {
        model: options.model,
        messages: [{ role: 'user', content: prompt }],
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      },
      { headers: { Authorization: `Bearer ${key}` }, timeout: options.timeoutMs }
    );

    const text = response.data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('resposta vazia');
    return { text, promptTokens: response.data.usage?.prompt_tokens, outputTokens: response.data.usage?.completion_tokens };
  } catch (error) {
    throw new Error(`Groq: ${describeHttpError(error)}`);
  }
}

// Cheap key check (lists models, no generation): used by `kvasir doctor`.
export async function checkGroqKey(timeoutMs: number, key: string | null = getGroqApiKey()): Promise<string | null> {
  if (!key) return 'sem chave';
  try {
    await axios.get(`${baseUrl()}/models`, { headers: { Authorization: `Bearer ${key}` }, timeout: timeoutMs });
    return null;
  } catch (error) {
    return describeHttpError(error);
  }
}
