import { stripThinking } from '@ai/ollama';
import type { TscDiagnostic } from '@utils/typecheck';

// Line fixes: deterministic rules first, AI second. Shared by kvasir fix and kvasir watch.

const CONTEXT_RADIUS = 15;

export interface SplitFile {
  lines: string[];
  eol: string;
}

export function splitFile(content: string): SplitFile {
  return { lines: content.split(/\r?\n/), eol: content.includes('\r\n') ? '\r\n' : '\n' };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceModuleSpecifier(line: string, from: string, to: string): string {
  return line.replace(new RegExp(`(['"])${escapeRegex(from)}\\1`), `$1${to}$1`);
}

// Each rule returns the fixed line, or the same line when it doesn't apply.
export const DETERMINISTIC_FIXES: Record<string, (line: string, diagnostic: TscDiagnostic) => string> = {
  // "Cannot import type declaration files. Consider importing 'X' instead of '@types/X'."
  TS6137: (line, diagnostic) => {
    const match = diagnostic.message.match(/importing '([^']+)' instead of '([^']+)'/);
    if (match) return replaceModuleSpecifier(line, match[2], match[1]);
    return line.replace(/(['"])@types\/([^'"]+)\1/, '$1$2');
  },
};

// TS2307/2305/2614/2792: module resolution · TS2688: type definitions · TS1259/1192: default-import
// interop · TS5xxx/TS18003: tsconfig. (TS6137 is complex too but has a proven deterministic fix.)
export const COMPLEX_CODES = /^TS(2307|2305|2614|2792|2688|1259|1192|5\d{3}|18003)$/;

export function applyDeterministicFix(line: string, diagnostic: TscDiagnostic): string | null {
  const rule = DETERMINISTIC_FIXES[diagnostic.code];
  if (!rule) return null;

  const fixed = rule(line, diagnostic);
  return fixed !== line ? fixed : null;
}

export function buildNumberedSnippet(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - CONTEXT_RADIUS);
  const end = Math.min(lines.length, lineIndex + CONTEXT_RADIUS + 1);
  const width = String(end).length;

  return lines
    .slice(start, end)
    .map((line, offset) => {
      const index = start + offset;
      const marker = index === lineIndex ? '>>' : '  ';
      return `${marker}${String(index + 1).padStart(width)} | ${line}`;
    })
    .join('\n');
}

export interface KnownFix {
  message: string;
  before: string;
  after: string;
}

export interface LineFixContext {
  // fixes of the same error code that worked before on this machine (knowledge/errors)
  knownFixes?: KnownFix[];
  // the previous attempt in this run and why it was rejected (kvasir watch self-correction)
  previousAttempt?: { line: string; reason: string };
  // related code from the rest of the project (OmniContext), already formatted
  projectContext?: string;
}

function describeKnownFixes(fixes: KnownFix[]): string {
  if (fixes.length === 0) return '';
  const examples = fixes.map((fix) => `- erro: ${fix.message}\n  antes:  ${fix.before}\n  depois: ${fix.after}`).join('\n');
  return `\nCorreções do mesmo erro que já deram certo neste projeto (use como referência, não copie se não servir):\n${examples}\n`;
}

const SNIPPET_RADIUS = 15;

// The query for related code and the part of the file the prompt already shows.
export function lineFixContextQuery(diagnostic: TscDiagnostic, lines: string[]): { query: string; shown: { file: string; startLine: number; endLine: number } } {
  return {
    query: `${diagnostic.code} ${diagnostic.message}\n${lines[diagnostic.lineIndex] ?? ''}`,
    shown: { file: diagnostic.filePath, startLine: diagnostic.lineIndex + 1 - SNIPPET_RADIUS, endLine: diagnostic.lineIndex + 1 + SNIPPET_RADIUS },
  };
}

export function buildLineFixPrompt(diagnostic: TscDiagnostic, lines: string[], context: LineFixContext = {}): string {
  const lineNumber = diagnostic.lineIndex + 1;
  const previous = context.previousAttempt
    ? `\nTentativa anterior (REJEITADA, não repita):\n${context.previousAttempt.line}\nMotivo: ${context.previousAttempt.reason}\n`
    : '';

  return `Você corrige UMA linha de um arquivo TypeScript a partir de um erro do compilador.

Erro do tsc:
${diagnostic.code}: ${diagnostic.message}

Arquivo: ${diagnostic.filePath} (linha ${lineNumber}, coluna ${diagnostic.column})

Trecho do arquivo (a linha com erro está marcada com >>):
${buildNumberedSnippet(lines, diagnostic.lineIndex)}

Linha ${lineNumber} atual:
${lines[diagnostic.lineIndex]}
${describeKnownFixes(context.knownFixes ?? [])}${context.projectContext ? `\n${context.projectContext}` : ''}${previous}
REGRAS:
- Responda SOMENTE com a linha ${lineNumber} já corrigida, dentro de um bloco \`\`\`ts
- Uma única linha. Não repita a linha atual, não explique, não mexa em outras linhas
- Use apenas nomes, imports e caminhos que aparecem no trecho ou na mensagem de erro
- Se o erro sugerir um nome ou caminho ("Did you mean", "Consider importing"), use exatamente o sugerido
- Corrija a causa: NUNCA esconda o erro com any, "as unknown as", @ts-ignore, @ts-expect-error, eslint-disable, nem comentando ou apagando a linha

Resposta (só o bloco \`\`\`ts com a linha ${lineNumber} corrigida):`;
}

const PROSE_PREFIX = /^\s*(#|\*\*|linha|corre[cç][aã]o|explica|aqui|here|the |a linha)/i;
const LABEL_PREFIX = /^\s*(depois|corrigid[ao]|linha corrigida|after|fixed)\s*:\s*/i;
const SNIPPET_PREFIX = /^\s*>?>?\s*\d+\s*\|\s?/;
const LOOKS_LIKE_CODE = /[;{}()=<>[\]'"`]|^\s*(import|export|const|let|var|return|function|type|interface|class)\b/;

// Models answer with a code fence, an echoed snippet, labels or prose: keep the first real code line
// that differs from the original, with the original indentation.
export function parseCorrectedLine(response: string, oldLine: string): string | null {
  const text = stripThinking(response);
  const fence = text.match(/```[\w-]*\r?\n([\s\S]*?)```/);
  const inline = text.match(/^`([^`]+)`$/m);
  const body = fence ? fence[1] : inline ? inline[1] : text;

  const candidate = body
    .split(/\r?\n/)
    .map((line) => line.replace(SNIPPET_PREFIX, '').replace(LABEL_PREFIX, ''))
    .filter((line) => line.trim().length > 0 && !line.trim().startsWith('```'))
    .filter((line) => fence !== null || inline !== null || (!PROSE_PREFIX.test(line) && LOOKS_LIKE_CODE.test(line)))
    .find((line) => line.trim() !== oldLine.trim());

  if (!candidate) return null;

  const indentation = oldLine.match(/^\s*/)?.[0] ?? '';
  return `${indentation}${candidate.trim()}`;
}
