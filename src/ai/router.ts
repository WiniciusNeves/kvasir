import os from 'os';
import path from 'path';
import { askOllamaDetailed, listInstalledModels } from '@ai/ollama';
import { askGemini, getGeminiApiKey, checkGeminiKey, DEFAULT_GEMINI_MODEL } from '@ai/gemini';
import { askGroq, getGroqApiKey, checkGroqKey, DEFAULT_GROQ_MODEL } from '@ai/groq';
import type { CloudProvider, ProviderName, ProviderResult } from '@ai/providers';
import { recordAiCall, readMetrics } from '@ai/metrics';
import { rankCandidates, PERFORMANCE_WINDOW_DAYS } from '@ai/performance';
import { agentForTask } from '@ai/agents';
import { startJob, switchJobModel, finishJob } from '@ai/jobs';
import type { AgentSettings } from '@utils/userConfig';
import type { RankedCandidate } from '@ai/performance';
import { promptAI } from '@ai/client';
import { readFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { readUserConfig, updateUserConfig } from '@utils/userConfig';
import { findExamples } from '@ai/examples';

export type AiTask = 'commit' | 'branch' | 'fix' | 'review' | 'doc' | 'architect' | 'guard' | 'pr' | 'daily' | 'release' | 'test' | 'intent' | 'ask' | 'docs';

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
  intent: ['qwen2.5-coder', 'llama3.2'],
  ask: ['qwen2.5-coder', 'llama3.2'],
  // edits must keep the markdown exact: qwen follows the section format better than llama3.2
  docs: ['qwen2.5-coder', 'llama3.2'],
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
  // only the sentence the user typed + the command list: fast answer matters
  intent: ['groq'],
  // kvasir ask sends pieces of the code base: local only
  ask: [],
  docs: ['gemini'],
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

export interface AskForOptions {
  maxTokens?: number;
  temperature?: number;
  repeatPenalty?: number;
  timeoutMs?: number;
  // what this case is about, in the shape the task records its examples (commit: the changed files;
  // branch: the task): the developer's most similar past answers go into the prompt
  examplesFor?: string;
}

export interface Candidate {
  provider: ProviderName;
  model: string;
  // what the orchestrator and the logs see: "groq/qwen/qwen3.8-27b", "qwen2.5-coder:latest"
  label: string;
}

// ---------------------------------------------------------------------------
// Cloud: keys from the environment, consent stored once in ~/.kvasir/config.json
// ---------------------------------------------------------------------------

export function cloudKeyFor(provider: CloudProvider): string | null {
  return provider === 'gemini' ? getGeminiApiKey() : getGroqApiKey();
}

// Validates a key against the provider without generating anything: null when accepted.
export async function checkCloudKey(provider: CloudProvider, key: string, timeoutMs = 10_000): Promise<string | null> {
  return provider === 'gemini' ? checkGeminiKey(timeoutMs, key) : checkGroqKey(timeoutMs, key);
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

// The owner agent can be swapped in ~/.kvasir/config.json (kvasir agents).
async function agentSettings(task: AiTask): Promise<AgentSettings> {
  return (await readUserConfig()).agents?.[agentForTask(task).name] ?? {};
}

async function cloudCandidates(task: AiTask): Promise<Candidate[]> {
  // CLOUD_MAP [] (guard, architect) is a privacy rule: no agent setting turns the cloud on there.
  if (CLOUD_MAP[task].length === 0 || (await agentSettings(task)).cloud === false || !(await isCloudAllowed())) return [];

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

  const chain = (await agentSettings(task)).models ?? MODEL_MAP[task];
  const candidates = chain
    .map((model) => installed.find((name) => matchesModel(name, model)))
    .filter((name): name is string => name !== undefined)
    .map((name): Candidate => ({ provider: 'ollama', model: name, label: name }));

  return {
    candidates,
    problem: candidates.length > 0 ? null : `Nenhum modelo para "${task}" está instalado no Ollama (${chain.join(', ')}). Rode "ollama pull ${chain[0]}".`,
  };
}

// Default order: cloud first (when allowed), Ollama after. Ollama being down is only fatal when
// there is no cloud. Then the measured performance reorders it (see performance.ts).
async function defaultCandidates(task: AiTask): Promise<Candidate[]> {
  const cloud = await cloudCandidates(task);
  const local = await localCandidates(task);
  if (cloud.length === 0 && local.problem) throw new Error(local.problem);
  return [...cloud, ...local.candidates];
}

export async function rankedCandidates(task: AiTask): Promise<RankedCandidate<Candidate>[]> {
  return rankCandidates(task, await defaultCandidates(task), await readMetrics(PERFORMANCE_WINDOW_DAYS));
}

async function resolveCandidates(task: AiTask): Promise<RankedCandidate<Candidate>[]> {
  const defaults = await defaultCandidates(task);
  const ranked = rankCandidates(task, defaults, await readMetrics(PERFORMANCE_WINDOW_DAYS));
  const first = ranked[0];
  // only worth saying when the measured performance changed who answers
  if (first && first.candidate !== defaults[0]) {
    console.log(`📈 ${first.candidate.label} responde primeiro em "${task}" pelo desempenho medido (${first.reason}).`);
  }
  return ranked;
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
  onResult: (label: string, result: string) => Promise<string>,
  examples = 0
): Promise<string> {
  const failures: string[] = [];
  // Agent Board: the owner agent's job is "em andamento" while its models work on it.
  const job = startJob(task, candidates[0]?.label ?? '');
  const agent = agentForTask(task).name;

  for (const candidate of candidates) {
    const startedAt = Date.now();
    switchJobModel(job, candidate.label);
    let result: ProviderResult;
    try {
      result = await callCandidate(candidate, prompt, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⚠️  ${candidate.label} falhou (${message}). Tentando o próximo...`);
      failures.push(`${candidate.label}: ${message}`);
      await recordAiCall({
        task, agent, title: job.title, provider: candidate.provider, model: candidate.model, role: 'executor', ok: false, error: message,
        durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: 0,
      });
      continue;
    }

    if (candidate.provider !== 'ollama') console.log(`☁️  Respondido por ${candidate.label}`);
    await recordAiCall({
      task, agent, title: job.title, provider: candidate.provider, model: candidate.model, role: 'executor', ok: true,
      durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: result.text.length,
      promptTokens: result.promptTokens, outputTokens: result.outputTokens, examples,
    });
    finishJob(job);
    return onResult(candidate.label, result.text);
  }

  finishJob(job);
  throw new Error(`Nenhum modelo respondeu para a tarefa "${task}".\n${failures.map((line) => `  - ${line}`).join('\n')}`);
}

// ---------------------------------------------------------------------------
// Prompts around the executor
// ---------------------------------------------------------------------------

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

// profile.md is "alive": the preferences `kvasir learn` consolidated go into the prompts where taste
// matters. Not into fix/architect, where only correctness counts.
const PREFERENCE_TASKS: AiTask[] = ['commit', 'branch', 'review', 'doc', 'pr', 'daily', 'release'];
const MAX_PREFERENCES_CHARS = 1200;
const EXAMPLES_IN_PROMPT = 3;
const MAX_EXAMPLE_INPUT_CHARS = 300;

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

// The developer's own answers in the most similar past cases: the style (length, language, scope)
// is copied from real examples, which local models follow better than a description of it.
async function withDeveloperExamples(task: AiTask, prompt: string, query: string | undefined): Promise<{ prompt: string; examples: number }> {
  if (!query || !PREFERENCE_TASKS.includes(task)) return { prompt, examples: 0 };
  const examples = await findExamples(task, query, EXAMPLES_IN_PROMPT);
  if (examples.length === 0) return { prompt, examples: 0 };

  const lines = examples.map((example) => `- Caso: ${example.input.split('\n').join(' · ').slice(0, MAX_EXAMPLE_INPUT_CHARS)}\n  Resposta dele: ${example.output}`);
  return {
    prompt: `Respostas reais deste desenvolvedor em casos parecidos (siga o estilo delas: tamanho, escopo, palavras; não copie o conteúdo). O formato e o idioma pedidos nas instruções abaixo valem mais que estes exemplos: se um exemplo foge do formato, use só o estilo dele dentro do formato pedido.
${lines.join('\n')}

${prompt}`,
    examples: examples.length,
  };
}

// Isolated context: the owner agent's role prompt, then (where taste matters) the developer's
// preferences and own past answers, then the task prompt. Nothing from other agents goes in.
async function buildAgentPrompt(task: AiTask, basePrompt: string, options: AskForOptions = {}): Promise<{ prompt: string; examples: number }> {
  const withExamples = await withDeveloperExamples(task, basePrompt, options.examplesFor);
  return { prompt: `${agentForTask(task).rolePrompt}\n\n${await withDeveloperPreferences(task, withExamples.prompt)}`, examples: withExamples.examples };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Claude (clipboard) as the validator, only while the model that answered has not earned trust
// in this task. The model is chosen by measured performance (no round trip): before, every askFor
// cost two copy-and-paste trips (choose + validate), even for a commit message.
const TRUST_MIN_VERDICTS = 5;
const TRUST_MIN_APPROVAL = 0.8;

export type ClaudeValidationMode = 'auto' | 'always' | 'never';

function trustReason(stats: { approved: number; rejected: number }): string | null {
  const verdicts = stats.approved + stats.rejected;
  if (verdicts < TRUST_MIN_VERDICTS) return null;
  const approval = stats.approved / verdicts;
  return approval >= TRUST_MIN_APPROVAL ? `aprovação ${Math.round(approval * 100)}% em ${verdicts} avaliações` : null;
}

export async function askFor(task: AiTask, basePrompt: string, options: AskForOptions = {}): Promise<string> {
  const ranked = await resolveCandidates(task);
  const { prompt, examples } = await buildAgentPrompt(task, basePrompt, options);
  const mode: ClaudeValidationMode = (await readUserConfig()).ai?.claudeValidation ?? 'auto';
  const statsByLabel = new Map(ranked.map((item) => [item.candidate.label, item.stats]));

  return runWithFallback(task, ranked.map((item) => item.candidate), prompt, options, async (label, result) => {
    const stats = statsByLabel.get(label);
    const trusted = stats ? trustReason(stats) : null;
    if (mode === 'never' || (mode === 'auto' && trusted)) {
      if (mode === 'auto') console.log(`✔ ${label} já é confiável em "${task}" (${trusted}): sem validação do Claude.`);
      return result;
    }
    if (mode === 'always') console.log('🔎 Validação do Claude (ai.claudeValidation: always).');
    else console.log(`🔎 Validação do Claude: ${label} ainda não provou que acerta em "${task}" (precisa de ${TRUST_MIN_VERDICTS}+ avaliações com ${Math.round(TRUST_MIN_APPROVAL * 100)}%+ de aprovação).`);
    return promptAI(buildValidationPrompt(task, prompt, label, result), { task, role: 'validator' });
  }, examples);
}

// No Claude round trips: cloud provider of the task (if allowed), then the local chain.
export async function askLocal(task: AiTask, basePrompt: string, options: AskForOptions = {}): Promise<string> {
  const candidates = (await resolveCandidates(task)).map((item) => item.candidate);
  const { prompt, examples } = await buildAgentPrompt(task, basePrompt, options);
  return runWithFallback(task, candidates, prompt, options, async (_label, result) => result, examples);
}
