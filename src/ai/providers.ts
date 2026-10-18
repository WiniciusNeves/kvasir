// Shared shape of every model provider the router can call.

export type CloudProvider = 'gemini' | 'groq';
export type ProviderName = 'ollama' | CloudProvider;

export interface CloudKeyInfo {
  variable: string;
  // where to create a free key
  url: string;
  // documented key prefix, only to warn about a wrong paste
  prefix: string;
}

export const CLOUD_KEY_INFO: Record<CloudProvider, CloudKeyInfo> = {
  gemini: { variable: 'GEMINI_API_KEY', url: 'https://aistudio.google.com/apikey', prefix: 'AIza' },
  groq: { variable: 'GROQ_API_KEY', url: 'https://console.groq.com/keys', prefix: 'gsk_' },
};

export interface ProviderCallOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ProviderResult {
  text: string;
  promptTokens?: number;
  outputTokens?: number;
}

// Short, key-free description of a failed HTTP call (axios messages can carry the request config).
export function describeHttpError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: unknown } }).response;
  if (response?.status === 429) return 'limite de uso atingido (429)';
  if (response?.status === 401 || response?.status === 403) return `chave recusada (${response.status})`;
  if (response?.status) return `erro ${response.status}`;
  const code = (error as { code?: string }).code;
  if (code === 'ECONNABORTED') return 'tempo esgotado';
  if (code) return `sem conexão (${code})`;
  return error instanceof Error ? error.message : String(error);
}
