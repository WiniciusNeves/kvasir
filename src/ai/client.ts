import { input } from '@utils/prompt';
import { recordAiCall } from '@ai/metrics';
import type { AiRole } from '@ai/metrics';

interface ClipboardyModule {
  write(text: string): Promise<void>;
  read(): Promise<string>;
}

async function loadClipboard(): Promise<ClipboardyModule> {
  const clipboardy = (await import('clipboardy')) as unknown as { default: ClipboardyModule };
  return clipboardy.default;
}

export async function readClipboard(): Promise<string> {
  const clipboard = await loadClipboard();
  return clipboard.read();
}

export async function writeClipboard(text: string): Promise<void> {
  const clipboard = await loadClipboard();
  await clipboard.write(text);
}

export interface PromptAIMeta {
  task: string;
  role: AiRole;
}

const SKIP_WORDS = ['p', 'pular'];

// The answer is read back from the clipboard: an inquirer `input` is single-line, so pasting a
// multi-line answer kept only the first line and leaked the rest into the next prompts.
// skippable: the caller already has an answer (the local model's), so the user may skip Claude
// (returns null). Without it, a typed text is taken as Claude's (short) answer.
async function askThroughClipboard(prompt: string, meta: PromptAIMeta, skippable: boolean): Promise<string | null> {
  const clipboard = await loadClipboard();
  await clipboard.write(prompt);
  const startedAt = Date.now();

  console.log(`\n--- ${skippable ? 'Validação pelo Claude' : 'Pergunta para o Claude'} (o prompt já está no seu clipboard) ---`);
  console.log('  1. Cole no chat do Claude (claude.ai ou app) e envie.');
  console.log('  2. Copie a resposta INTEIRA do Claude.');
  console.log('  3. Volte aqui e pressione Enter.');
  if (skippable) console.log('  Sem tempo ou sem o Claude aberto? Digite "p" e Enter para pular e usar a resposta do modelo local.');

  let answer = '';
  for (;;) {
    const typed = await input(
      skippable ? 'Enter quando a resposta estiver copiada ("p" para pular):' : 'Enter quando a resposta estiver copiada (ou digite uma resposta curta):'
    );
    if (skippable && SKIP_WORDS.includes(typed.trim().toLowerCase())) {
      console.log('⏭️  Validação pulada: vale a resposta do modelo local.');
      return null;
    }
    if (typed.trim() && !skippable) {
      answer = typed.trim();
      break;
    }
    if (typed.trim()) {
      console.log('⚠️  Aqui não dá para digitar a resposta: copie a resposta do Claude e pressione Enter, ou digite "p" para pular.');
      continue;
    }

    const pasted = (await clipboard.read()).trim();
    if (pasted && pasted !== prompt.trim()) {
      answer = pasted;
      break;
    }

    console.log(`⚠️  O clipboard ainda contém o prompt (ou está vazio). Copie a resposta do Claude e tente de novo${skippable ? ', ou digite "p" para pular' : ''}.`);
  }

  // Claude via clipboard reports no tokens: chars and the human round-trip time show the cost.
  await recordAiCall({
    task: meta.task, provider: 'claude', model: 'claude (clipboard)', role: meta.role, ok: true,
    durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: answer.length,
  });
  return answer;
}

export async function promptAI(prompt: string, meta: PromptAIMeta = { task: 'direct', role: 'direct' }): Promise<string> {
  return (await askThroughClipboard(prompt, meta, false)) ?? '';
}

// Validation of an answer the caller already has: null when the user skips Claude.
export async function promptAIOrSkip(prompt: string, meta: PromptAIMeta): Promise<string | null> {
  return askThroughClipboard(prompt, meta, true);
}
