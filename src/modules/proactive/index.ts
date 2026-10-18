import os from 'os';
import path from 'path';
import { readJson, writeFile } from '@utils/fs';
import { confirm, select } from '@utils/prompt';
import { printCliError } from '@utils/errors';

// Proactive suggestions (backlog block 9) with autonomy that grows with trust: every suggestion
// starts as a question; the user's answers decide whether it becomes automatic, keeps asking or
// stops. Whether a suggestion applies is decided by code (facts), never by a model.
// State: ~/.kvasir/proactive.json.

export type SuggestionId = 'branch-for-task' | 'review-before-commit' | 'doc-new-lib' | 'stale-branch';
export type SuggestionMode = 'ask' | 'auto' | 'off';

export const SUGGESTION_LABELS: Record<SuggestionId, string> = {
  'branch-for-task': 'Criar a branch da task quando você está na main/develop',
  'review-before-commit': 'Revisar antes de commitar uma mudança grande',
  'doc-new-lib': 'Documentar uma lib nova adicionada no package.json',
  'stale-branch': 'Apagar branch local parada há muito tempo',
};

// Actions with side effects in git never become automatic.
export const AUTO_ALLOWED: Record<SuggestionId, boolean> = {
  'branch-for-task': false,
  'review-before-commit': true,
  'doc-new-lib': true,
  'stale-branch': false,
};

type Answer = 'yes' | 'no';

export interface SuggestionRecord {
  mode: SuggestionMode;
  // last answers, newest last
  history: Answer[];
  accepted: number;
  rejected: number;
  autoRuns: number;
  offeredAuto?: boolean;
  // keys the user said "not this one" to (a branch, a lib)
  dismissed: string[];
}

export interface ProactiveState {
  suggestions: Partial<Record<SuggestionId, SuggestionRecord>>;
  // hash of the staged diff the last review looked at
  reviewedDiff?: string;
}

export interface Suggestion {
  id: SuggestionId;
  // what the suggestion is about, so "not this one" can be remembered (branch name, lib)
  key?: string;
  question: string;
  // shown when it runs automatically
  action: string;
  run: () => Promise<void>;
}

const HISTORY_SIZE = 10;
const MIN_ANSWERS = 5;
const AUTO_RATE = 0.9;
const OFF_RATE = 0.2;

// One suggestion per command at most: more than that is noise.
let suggestedThisRun = false;

function stateFile(): string {
  return path.join(os.homedir(), '.kvasir', 'proactive.json');
}

export async function readProactiveState(): Promise<ProactiveState> {
  return (await readJson<ProactiveState>(stateFile())) ?? { suggestions: {} };
}

export async function writeProactiveState(state: ProactiveState): Promise<void> {
  await writeFile(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
}

export function emptyRecord(): SuggestionRecord {
  return { mode: 'ask', history: [], accepted: 0, rejected: 0, autoRuns: 0, dismissed: [] };
}

function acceptance(history: Answer[]): number {
  return history.length === 0 ? 0 : history.filter((answer) => answer === 'yes').length / history.length;
}

async function runSafely(suggestion: Suggestion): Promise<void> {
  try {
    await suggestion.run();
  } catch (error) {
    // a suggestion must never break the command that offered it
    printCliError(error);
  }
}

// Returns true when the suggestion ran (asked and accepted, or automatic).
export async function offerSuggestion(suggestion: Suggestion): Promise<boolean> {
  if (suggestedThisRun) return false;

  const state = await readProactiveState();
  const record = state.suggestions[suggestion.id] ?? emptyRecord();
  if (record.mode === 'off') return false;
  if (suggestion.key && record.dismissed.includes(suggestion.key)) return false;

  suggestedThisRun = true;

  if (record.mode === 'auto' && AUTO_ALLOWED[suggestion.id]) {
    console.log(`\n⚡ ${suggestion.action} (automático: você sempre aceitou; mudar em "kvasir proactive")`);
    record.autoRuns += 1;
    state.suggestions[suggestion.id] = record;
    await writeProactiveState(state);
    await runSafely(suggestion);
    return true;
  }

  type Choice = Answer | 'not-this' | 'never';
  console.log('');
  const choice = await select<Choice>(`💡 ${suggestion.question}`, [
    { name: 'Sim', value: 'yes' },
    { name: 'Agora não', value: 'no' },
    ...(suggestion.key ? [{ name: `Não perguntar mais sobre "${suggestion.key}"`, value: 'not-this' as const }] : []),
    { name: 'Nunca mais sugerir isso', value: 'never' },
  ]);

  if (choice === 'never') {
    record.mode = 'off';
  } else if (choice === 'not-this' && suggestion.key) {
    record.dismissed = [...record.dismissed, suggestion.key];
  } else {
    const answer: Answer = choice === 'yes' ? 'yes' : 'no';
    record.history = [...record.history, answer].slice(-HISTORY_SIZE);
    if (answer === 'yes') record.accepted += 1;
    else record.rejected += 1;
  }
  state.suggestions[suggestion.id] = record;
  await writeProactiveState(state);

  if (choice === 'never') {
    console.log('Ok, não sugiro mais isso (para voltar: kvasir proactive).');
    return false;
  }
  if (choice !== 'yes') {
    await maybeStopAsking(suggestion.id);
    return false;
  }

  await runSafely(suggestion);
  await maybeGoAutomatic(suggestion.id);
  return true;
}

// Trust grew: accepted almost every time → offer to stop asking (once).
async function maybeGoAutomatic(id: SuggestionId): Promise<void> {
  const state = await readProactiveState();
  const record = state.suggestions[id];
  if (!record || !AUTO_ALLOWED[id] || record.offeredAuto || record.history.length < MIN_ANSWERS) return;
  if (acceptance(record.history) < AUTO_RATE) return;

  const yes = record.history.filter((answer) => answer === 'yes').length;
  record.offeredAuto = true;
  const auto = await confirm(`Você aceitou "${SUGGESTION_LABELS[id]}" ${yes} de ${record.history.length} vezes. Fazer sempre, sem perguntar?`);
  if (auto) record.mode = 'auto';
  state.suggestions[id] = record;
  await writeProactiveState(state);
  if (auto) console.log('⚡ Combinado: daqui em diante faço sozinho (mudar em "kvasir proactive").');
}

// The user keeps saying no → stop bothering (they can turn it back on).
async function maybeStopAsking(id: SuggestionId): Promise<void> {
  const state = await readProactiveState();
  const record = state.suggestions[id];
  if (!record || record.history.length < MIN_ANSWERS || acceptance(record.history) > OFF_RATE) return;

  record.mode = 'off';
  state.suggestions[id] = record;
  await writeProactiveState(state);
  const no = record.history.filter((answer) => answer === 'no').length;
  console.log(`🔕 Parei de sugerir "${SUGGESTION_LABELS[id]}" (você recusou ${no} de ${record.history.length}). Para voltar: kvasir proactive`);
}
