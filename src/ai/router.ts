import os from 'os';
import path from 'path';
import { askOllamaDetailed, listInstalledModels } from '@ai/ollama';
import { askGemini, getGeminiApiKey, DEFAULT_GEMINI_MODEL } from '@ai/gemini';
import { askGroq, getGroqApiKey, DEFAULT_GROQ_MODEL } from '@ai/groq';
import type { CloudProvider, ProviderName, ProviderResult } from '@ai/providers';
import { recordAiCall } from '@ai/metrics';
import { promptAI } from '@ai/client';
import { readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { readUserConfig, updateUserConfig } from '@utils/userConfig';

export type AiTask = 'commit' | 'branch' | 'fix' | 'review' | 'doc' | 'architect' | 'guard' | 'pr' | 'daily' | 'release' | 'test';

// Local fallback chain (Ollama). Always the last resort: offline, private, no rate limit.
export const MODEL_MAP: Record<AiTask, string[]> = {
  commit: ['qwen2.5-coder', 'codellama'],
  branch: ['qwen2.5-coder', 'codellama'],
  fix: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  review: ['qwen2.5-coder', 'deepseek-r1', 'codellama'],
  doc: ['llama3.2', 'qwen2.5-coder'],
  architect: ['deepseek-r1', 'llama3.2'],
  guard: ['qwen2.5-coder', 'llama3.2'],
  pr: ['qwen2.5-coder', 'llama3.2'],
  daily: ['llama3.2', 'qwen2.5-coder'],
  release: ['qwen2.5-coder', 'llama3.2'],
  test: ['qwen2.5-coder', 'deepseek-r1'],
};

// Cloud providers tried BEFORE Ollama when the user allowed the cloud (roadmap phase 2):
// Portuguese text → Gemini Flash · code → Groq. guard never leaves the machine (its prompt holds
// secret candidates); architect stays on the local deepseek-r1 (backlog: "arquitetura → deepseek-r1").
export const CLOUD_MAP: Record<AiTask, CloudProvider[]> = {
  commit: ['groq'],
  branch: ['groq'],
  fix: ['groq'],
  review: ['groq'],
  test: ['groq'],
  doc: ['gemini'],
  daily: ['gemini'],
  release: ['gemini'],
  pr: ['gemini', 'groq'],
  architect: [],
  guard: [],
};

// 30s was not enough for a cold model load or deepseek-r1 thinking: the chosen model timed out
// and a weaker fallback answered silently instead.
const REQUEST_TIMEOUT_MS = 120_000;
const CLOUD_TIMEOUT_MS = 60_000;
const CONTEXT_FILE = 'kvasir.context.md';

export interface AskForOptions {
  maxTokens?: number;
  temperature?: number;
  repeatPenalty?: number;
  timeoutMs?: number;
}

export interface Candidate {
  provider: ProviderName;
  model: string;
  // what the orchestrator and the logs see: "groq/llama-3.3-70b-versatile", "qwen2.5-coder:latest"
  label: string;
}

// ---------------------------------------------------------------------------
// Cloud: keys from the environment, consent stored once in ~/.kvasir/config.json
// ---------------------------------------------------------------------------

export function cloudKeyFor(provider: CloudProvider): string | null {
  return provider === 'gemini' ? getGeminiApiKey() : getGroqApiKey();
}

export async function cloudModelFor(provider: CloudProvider): Promise<string> {
  const settings = (await readUserConfig()).ai ?? {};
  return provider === 'gemini' ? settings.geminiModel || DEFAULT_GEMINI_MODEL : settings.groqModel || DEFAULT_GROQ_MODEL;
}

export async function setCloudConsent(allowed: boolean): Promise<void> {
  await updateUserConfig((config) => {
    config.ai = { ...config.ai, cloud: allowed };
  });
}

// Prompts can carry the company's code: nothing goes to the cloud without an explicit yes.
let consentAskedThisRun = false;
async function isCloudAllowed(): Promise<boolean> {
  if (!getGeminiApiKey() && !getGroqApiKey()) return false;

  const consent = (await readUserConfig()).ai?.cloud;
  if (consent !== undefined) return consent;
  if (consentAskedThisRun) return false;

  consentAskedThisRun = true;
  console.log('\n☁️  Encontrei chave do Gemini/Groq no ambiente.');
  const allowed = await confirm(
    'Permitir que o Kvasir envie prompts (que podem conter código do projeto) para a nuvem? Sem isso, tudo continua no Ollama local.'
  );
  await setCloudConsent(allowed);
  console.log(allowed ? 'Nuvem permitida (desligue com "kvasir models --cloud off").' : 'Ok, só Ollama local (ligue com "kvasir models --cloud on").');
  return allowed;
}

async function cloudCandidates(task: AiTask): Promise<Candidate[]> {
  if (CLOUD_MAP[task].length === 0 || !(await isCloudAllowed())) return [];

  const candidates: Candidate[] = [];
  for (const provider of CLOUD_MAP[task]) {
    if (!cloudKeyFor(provider)) continue;
    const model = await cloudModelFor(provider);
    candidates.push({ provider, model, label: `${provider}/${model}` });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Local: MODEL_MAP names resolved against the installed tags
// ---------------------------------------------------------------------------

function matchesModel(name: string, model: string): boolean {
  return name === model || name.startsWith(`${model}:`) || model.startsWith(`${name}:`);
}

// MODEL_MAP uses bare names ("qwen2.5-coder"), which Ollama only resolves to ":latest".
// A model installed as "qwen2.5-coder:7b" returned 404 and the router fell back silently.
async function localCandidates(task: AiTask): Promise<{ candidates: Candidate[]; problem: string | null }> {
  let installed: string[];
  try {
    installed = await listInstalledModels();
  } catch {
    return { candidates: [], problem: 'Não foi possível conectar ao Ollama em http://localhost:11434. Verifique se o Ollama está rodando.' };
  }

  const candidates = MODEL_MAP[task]
    .map((model) => installed.find((name) => matchesModel(name, model)))
    .filter((name): name is string => name !== undefined)
    .map((name): Candidate => ({ provider: 'ollama', model: name, label: name }));

  return {
    candidates,
    problem: candidates.length > 0 ? null : `Nenhum modelo para "${task}" está instalado no Ollama (${MODEL_MAP[task].join(', ')}). Rode "ollama pull ${MODEL_MAP[task][0]}".`,
  };
}

// Cloud first (when allowed), Ollama after. Ollama being down is only fatal when there is no cloud.
async function resolveCandidates(task: AiTask): Promise<Candidate[]> {
  const cloud = await cloudCandidates(task);
  const local = await localCandidates(task);
  if (cloud.length === 0 && local.problem) throw new Error(local.problem);
  return [...cloud, ...local.candidates];
}

// ---------------------------------------------------------------------------
// Calling and fallback
// ---------------------------------------------------------------------------

async function callCandidate(candidate: Candidate, prompt: string, options: AskForOptions): Promise<ProviderResult> {
  if (candidate.provider === 'gemini') {
    return askGemini(prompt, { model: candidate.model, maxTokens: options.maxTokens, temperature: options.temperature, timeoutMs: options.timeoutMs ?? CLOUD_TIMEOUT_MS });
  }
  if (candidate.provider === 'groq') {
    return askGroq(prompt, { model: candidate.model, maxTokens: options.maxTokens, temperature: options.temperature, timeoutMs: options.timeoutMs ?? CLOUD_TIMEOUT_MS });
  }
  return askOllamaDetailed(prompt, { ...options, model: candidate.model, timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS });
}

// Rate limit (429), bad key, timeout or no network: the next candidate answers, ending in Ollama.
async function runWithFallback(
  task: AiTask,
  candidates: Candidate[],
  prompt: string,
  options: AskForOptions,
  onResult: (label: string, result: string) => Promise<string>
): Promise<string> {
  const failures: string[] = [];

  for (const candidate of candidates) {
    const startedAt = Date.now();
    let result: ProviderResult;
    try {
      result = await callCandidate(candidate, prompt, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⚠️  ${candidate.label} falhou (${message}). Tentando o próximo...`);
      failures.push(`${candidate.label}: ${message}`);
      await recordAiCall({
        task, provider: candidate.provider, model: candidate.model, role: 'executor', ok: false, error: message,
        durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: 0,
      });
      continue;
    }

    if (candidate.provider !== 'ollama') console.log(`☁️  Respondido por ${candidate.label}`);
    await recordAiCall({
      task, provider: candidate.provider, model: candidate.model, role: 'executor', ok: true,
      durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: result.text.length,
      promptTokens: result.promptTokens, outputTokens: result.outputTokens,
    });
    return onResult(candidate.label, result.text);
  }

  throw new Error(`Nenhum modelo respondeu para a tarefa "${task}".\n${failures.map((line) => `  - ${line}`).join('\n')}`);
}

// ---------------------------------------------------------------------------
// Prompts around the executor
// ---------------------------------------------------------------------------

async function getProjectArchitecture(): Promise<string> {
  const content = await readFile(CONTEXT_FILE);
  return content ?? '(kvasir.context.md não encontrado — rode "kvasir init")';
}

function buildOrchestratorPrompt(task: AiTask, prompt: string, architecture: string, labels: string[]): string {
  return `Você é o orquestrador. Analise e decida qual modelo usar. Depois valide o resultado antes de retornar.

Tarefa: ${task}

Arquitetura do projeto (kvasir.context.md):
${architecture}

Modelos disponíveis para esta tarefa (os com "/" estão na nuvem; os outros, no Ollama local): ${labels.join(', ')}

Analise a tarefa e o prompt abaixo e decida qual desses modelos é o mais adequado para executá-la.

Responda APENAS com uma linha no formato:
MODELO: <nome-do-modelo>

Tarefa/erro e prompt que será enviado ao modelo escolhido:
${prompt}`;
}

function buildValidationPrompt(task: AiTask, prompt: string, model: string, result: string): string {
  return `Você é o orquestrador, validando o resultado de um modelo antes de retorná-lo.

Tarefa: ${task}
Modelo executor: ${model}

Prompt original enviado ao modelo:
${prompt}

Resultado retornado pelo modelo:
${result}

Valide se o resultado está correto e completo para a tarefa. Se estiver correto, responda com o resultado final. Se houver problemas, corrija e responda apenas com o resultado final já corrigido. Responda APENAS com o resultado final, sem explicações sobre a validação.`;
}

function extractChosen(decision: string, candidates: Candidate[]): Candidate {
  const match = decision.match(/MODELO:\s*(\S+)/i);
  const chosen = match ? match[1].replace(/[`'"*]/g, '').trim() : null;

  if (chosen) {
    const known = candidates.find((candidate) => candidate.label === chosen || matchesModel(chosen, candidate.model));
    if (known) return known;
  }
  return candidates[0];
}

// profile.md is "alive": the preferences `kvasir learn` consolidated go into the prompts where taste
// matters. Not into fix/architect, where only correctness counts.
const PREFERENCE_TASKS: AiTask[] = ['commit', 'branch', 'review', 'doc', 'pr', 'daily', 'release'];
const MAX_PREFERENCES_CHARS = 1200;

function getProfilePath(): string {
  return path.join(os.homedir(), '.kvasir', 'profile.md');
}

async function withDeveloperPreferences(task: AiTask, prompt: string): Promise<string> {
  if (!PREFERENCE_TASKS.includes(task)) return prompt;

  const profile = (await readFile(getProfilePath())) ?? '';
  const section = profile.replace(/\r\n/g, '\n').match(/## Preferências aprendidas\n([\s\S]*?)(?=\n## |$)/);
  const preferences = section?.[1].trim() ?? '';
  if (!preferences) return prompt;

  return `Preferências aprendidas deste desenvolvedor (siga quando não conflitarem com as regras abaixo):
${preferences.slice(0, MAX_PREFERENCES_CHARS)}

${prompt}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Claude (clipboard) picks the candidate and validates the result.
export async function askFor(task: AiTask, basePrompt: string, options: AskForOptions = {}): Promise<string> {
  const candidates = await resolveCandidates(task);
  const prompt = await withDeveloperPreferences(task, basePrompt);

  const architecture = await getProjectArchitecture();
  const labels = candidates.map((candidate) => candidate.label);
  const decision = await promptAI(buildOrchestratorPrompt(task, prompt, architecture, labels), { task, role: 'orchestrator' });
  const chosen = extractChosen(decision, candidates);
  const ordered = [chosen, ...candidates.filter((candidate) => candidate !== chosen)];

  return runWithFallback(task, ordered, prompt, options, (label, result) =>
    promptAI(buildValidationPrompt(task, prompt, label, result), { task, role: 'validator' })
  );
}

// No Claude round trips: cloud provider of the task (if allowed), then the local chain.
export async function askLocal(task: AiTask, basePrompt: string, options: AskForOptions = {}): Promise<string> {
  const candidates = await resolveCandidates(task);
  const prompt = await withDeveloperPreferences(task, basePrompt);
  return runWithFallback(task, candidates, prompt, options, async (_label, result) => result);
}
