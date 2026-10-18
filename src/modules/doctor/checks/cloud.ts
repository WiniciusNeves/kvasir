import { checkGeminiKey, getGeminiApiKey } from '@ai/gemini';
import { checkGroqKey, getGroqApiKey } from '@ai/groq';
import { readUserConfig } from '@utils/userConfig';
import type { CheckResult } from '@ktypes/doctor';

const KEY_CHECK_TIMEOUT_MS = 10_000;

// Optional: everything works with Ollama alone, so a missing key is only informational.
export async function checkCloud(): Promise<CheckResult[]> {
  if (!getGeminiApiKey() && !getGroqApiKey()) {
    return [{ name: 'Gemini / Groq', status: 'ok', detail: 'não configurados (opcional: tudo roda no Ollama local)' }];
  }

  const results: CheckResult[] = [];
  const providers = [
    { name: 'Gemini', variable: 'GEMINI_API_KEY', present: Boolean(getGeminiApiKey()), check: checkGeminiKey, url: 'aistudio.google.com' },
    { name: 'Groq', variable: 'GROQ_API_KEY', present: Boolean(getGroqApiKey()), check: checkGroqKey, url: 'console.groq.com' },
  ];

  for (const provider of providers) {
    if (!provider.present) {
      results.push({ name: provider.name, status: 'ok', detail: `sem chave (opcional: ${provider.variable}, grátis em ${provider.url})` });
      continue;
    }
    const problem = await provider.check(KEY_CHECK_TIMEOUT_MS);
    results.push(
      problem
        ? { name: provider.name, status: 'warn', detail: `chave definida, mas a API respondeu: ${problem}`, fix: `Confira a chave em ${provider.url}` }
        : { name: provider.name, status: 'ok', detail: 'chave válida' }
    );
  }

  const consent = (await readUserConfig()).ai?.cloud;
  results.push(
    consent === true
      ? { name: 'Envio para a nuvem', status: 'ok', detail: 'permitido (desligar: kvasir models --cloud off)' }
      : consent === false
        ? { name: 'Envio para a nuvem', status: 'warn', detail: 'desligado: as chaves não estão sendo usadas', fix: 'kvasir models --cloud on' }
        : { name: 'Envio para a nuvem', status: 'warn', detail: 'ainda não autorizado (pergunto no primeiro uso)', fix: 'kvasir models --cloud on' }
  );

  return results;
}
