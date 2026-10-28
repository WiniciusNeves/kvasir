import { stripThinking } from '@ai/ollama';

// Helpers for the answers of local models, which wrap results in code fences, quotes,
// labels ("Commit message:") or explanations no matter what the prompt says.

export function cleanAnswer(text: string): string {
  return stripThinking(text).replace(/\r/g, '').trim();
}

// The validator (local model or Claude) wraps its final answer in this tag. Without it the text is not
// a validation answer: a stray clipboard copy or a model's explanation must not replace the result.
export const ANSWER_TAG = 'resposta';
const ANSWER_PATTERN = new RegExp(`<${ANSWER_TAG}>([\\s\\S]*?)</${ANSWER_TAG}>`, 'g');

// The last tagged block wins: models sometimes repeat the prompt's example tag before the real answer.
export function extractTaggedAnswer(text: string): string | null {
  const matches = [...cleanAnswer(text).matchAll(ANSWER_PATTERN)];
  const answer = matches.at(-1)?.[1].trim();
  return answer ? answer : null;
}

export function answerLines(text: string): string[] {
  const clean = cleanAnswer(text);
  const fence = clean.match(/```[\w-]*\n([\s\S]*?)```/);
  const body = fence ? fence[1] : clean;

  return body
    .split('\n')
    .map((line) => line.trim().replace(/^[-*>]\s+/, '').replace(/^["'`]+|["'`]+$/g, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('```'));
}

// First line matching `pattern`, also trying it without a leading label like "Commit message:".
// Returns null when no line matches.
export function pickLine(text: string, pattern: RegExp): string | null {
  for (const line of answerLines(text)) {
    if (pattern.test(line)) return line;

    const withoutLabel = line.replace(/^[^:]{2,40}:\s*/, '').replace(/^["'`]+|["'`]+$/g, '');
    if (pattern.test(withoutLabel)) return withoutLabel;
  }
  return null;
}

export function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... cortado: ${text.length - maxChars} caracteres omitidos ...]`;
}
