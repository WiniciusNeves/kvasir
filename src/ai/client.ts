import { input, select } from '@utils/prompt';
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

type ClipboardChoice = 'copied' | 'type' | 'skip';

// The answer is read back from the clipboard: an inquirer `input` is single-line, so pasting a
// multi-line answer kept only the first line and leaked the rest into the next prompts.
// A menu (not typed commands) says what to do next. skippable: the caller already has an answer
// (the local model's), so the user may skip Claude (returns null); otherwise a short answer can be typed.
async function askThroughClipboard(prompt: string, meta: PromptAIMeta, skippable: boolean): Promise<string | null> {
  const clipboard = await loadClipboard();
  await clipboard.write(prompt);
  const startedAt = Date.now();

  console.log(`
--- ${skippable ? 'Validação pelo Claude' : 'Pergunta para o Claude'} ---`);
  console.log('O prompt já está no seu clipboard: cole no chat do Claude (claude.ai ou app), envie,');
  console.log('copie a resposta INTEIRA dele e depois escolha abaixo.');

  let answer = '';
  for (;;) {
    const choice = await select<ClipboardChoice>('O que você quer fazer?', [
      { name: 'Já copiei a resposta do Claude', value: 'copied' },
      skippable
        ? { name: 'Pular o Claude: usar a resposta do modelo local', value: 'skip' }
        : { name: 'Digitar uma resposta curta', value: 'type' },
    ]);
    if (choice === 'skip') {
      console.log('⏭️  Validação pulada: vale a resposta do modelo local.');
      return null;
    }
    if (choice === 'type') {
      answer = (await input('Resposta:')).trim();
      if (answer) break;
      continue;
    }

    const pasted = (await clipboard.read()).trim();
    if (pasted && pasted !== prompt.trim()) {
      answer = pasted;
      break;
    }
    console.log('⚠️  O clipboard ainda tem o prompt (ou está vazio): a resposta do Claude não foi copiada.');
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
