import { input } from '@utils/prompt';

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

// The answer is read back from the clipboard: an inquirer `input` is single-line, so pasting a
// multi-line answer kept only the first line and leaked the rest into the next prompts.
export async function promptAI(prompt: string): Promise<string> {
  const clipboard = await loadClipboard();
  await clipboard.write(prompt);

  console.log('\n--- Prompt copiado para o clipboard ---');
  console.log('Cole no Claude (chat), copie a resposta INTEIRA e volte aqui.');

  for (;;) {
    const typed = await input('Pressione Enter quando a resposta estiver copiada (ou digite uma resposta curta):');
    if (typed.trim()) return typed.trim();

    const answer = (await clipboard.read()).trim();
    if (answer && answer !== prompt.trim()) return answer;

    console.log('⚠️  O clipboard ainda contém o prompt (ou está vazio). Copie a resposta do Claude e tente de novo.');
  }
}
