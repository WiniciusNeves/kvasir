import { input } from '@utils/prompt';

interface ClipboardyModule {
  write(text: string): Promise<void>;
}

export async function promptAI(prompt: string): Promise<string> {
  const clipboardy = (await import('clipboardy')) as unknown as { default: ClipboardyModule };
  await clipboardy.default.write(prompt);

  console.log('\n--- Prompt copied to clipboard ---');
  console.log('Paste it into Claude (chat) and copy the response back here.');

  return input('Paste the AI response:');
}
