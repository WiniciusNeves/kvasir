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

// The answer is read back from the clipboard: an inquirer `input` is single-line, so pasting a
// multi-line answer kept only the first line and leaked the rest into the next prompts.
export async function promptAI(prompt: string, meta: PromptAIMeta = { task: 'direct', role: 'direct' }): Promise<string> {
  const clipboard = await loadClipboard();
  await clipboard.write(prompt);
  const startedAt = Date.now();

  console.log('\n--- Prompt copiado para o clipboard ---');
  console.log('Cole no Claude (chat), copie a resposta INTEIRA e volte aqui.');

  let answer = '';
  for (;;) {
    const typed = await input('Pressione Enter quando a resposta estiver copiada (ou digite uma resposta curta):');
    if (typed.trim()) {
      answer = typed.trim();
      break;
    }

    const pasted = (await clipboard.read()).trim();
    if (pasted && pasted !== prompt.trim()) {
      answer = pasted;
      break;
    }

    console.log('⚠️  O clipboard ainda contém o prompt (ou está vazio). Copie a resposta do Claude e tente de novo.');
  }

  // Claude via clipboard reports no tokens: chars and the human round-trip time show the cost.
  await recordAiCall({
    task: meta.task, provider: 'claude', model: 'claude (clipboard)', role: meta.role, ok: true,
    durationMs: Date.now() - startedAt, promptChars: prompt.length, outputChars: answer.length,
  });
  return answer;
}
