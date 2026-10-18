import axios from 'axios';
import { describeHttpError } from '@ai/providers';
import { readSavedUserEnv } from '@utils/userEnv';
import type { ProviderCallOptions, ProviderResult } from '@ai/providers';

// Gemini Flash (Google AI Studio, free tier). Key from the environment only.
// "-latest" alias: Google keeps it pointing to the current Flash (fixed names like gemini-2.5-flash got retired).
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
// Current Flash models think before answering and the thoughts count against maxOutputTokens: with
// the small limits the modules use, the answer came back empty (finishReason MAX_TOKENS).
const THINKING_HEADROOM_TOKENS = 1024;

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.KVASIR_GEMINI_API_KEY || readSavedUserEnv('GEMINI_API_KEY');
}

// KVASIR_GEMINI_BASE_URL: proxy or local mock (tests).
function baseUrl(): string {
  return (process.env.KVASIR_GEMINI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
}

export async function askGemini(prompt: string, options: ProviderCallOptions): Promise<ProviderResult> {
  const key = getGeminiApiKey();
  if (!key) throw new Error('GEMINI_API_KEY não definida');

  try {
    const response = await axios.post<GeminiResponse>(
      `${baseUrl()}/v1beta/models/${encodeURIComponent(options.model)}:generateContent`,
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          // Text tasks only (doc, daily, release, pr): ask for no thinking. Gemini 3.x does not always
          // honor it, hence the headroom below.
          thinkingConfig: { thinkingBudget: 0 },
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens ? { maxOutputTokens: options.maxTokens + THINKING_HEADROOM_TOKENS } : {}),
        },
      },
      { headers: { 'x-goog-api-key': key }, timeout: options.timeoutMs }
    );

    const text = (response.data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();
    if (!text) throw new Error('resposta vazia');
    return {
      text,
      promptTokens: response.data.usageMetadata?.promptTokenCount,
      outputTokens: response.data.usageMetadata?.candidatesTokenCount,
    };
  } catch (error) {
    throw new Error(`Gemini: ${describeHttpError(error)}`);
  }
}

// Cheap key check (lists models, no generation): used by `kvasir doctor` and `kvasir keys set`.
export async function checkGeminiKey(timeoutMs: number, key: string | null = getGeminiApiKey()): Promise<string | null> {
  if (!key) return 'sem chave';
  try {
    await axios.get(`${baseUrl()}/v1beta/models`, { headers: { 'x-goog-api-key': key }, timeout: timeoutMs });
    return null;
  } catch (error) {
    return describeHttpError(error);
  }
}
