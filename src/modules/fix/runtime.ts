import path from 'path';
import { askLocal } from '@ai/router';
import { recordOutcome, peekLastExecutorCall } from '@ai/metrics';
import { readFile, writeFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { runTypecheck } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { resolveLocalImports } from '@utils/imports';
import { isTestFile } from '@utils/runtimeErrors';
import type { RuntimeError } from '@utils/runtimeErrors';
import { hasLocalTestRunner, runTestFile } from '@utils/testRunner';
import { truncateForPrompt } from '@ai/parse';
import { detectTestSetup } from '@modules/test/framework';
import { noteFixedError } from '@modules/knowledge/auto';
import { ensureBackup, attachCallToBackup } from './backup';
import type { FixBackup, FixCall } from './backup';
import { splitFile, buildNumberedSnippet, parseCorrectedLine } from './line';
import { hidingReason, findNewErrors, describeNewErrors, runRelatedTests } from './validate';

// A runtime error (exception, failed test) fixed by changing ONE line, chosen by the model among the
// project files of the stack. Validation: no hiding, no new type errors, and the failing test passes
// again (confirmed). Without a test to rerun the fix is provisional: kvasir watch undoes it if the
// same error shows up again.

const MAX_ATTEMPTS = 2;
const MAX_CONTEXT_FILES = 4;
const HEAD_LINES = 80;
const MAX_RAW_CHARS = 1500;
const MAX_TOKENS = 300;

export interface RuntimeAttempt {
  line: string;
  reason: string;
}

export type RuntimeFixStatus = 'fixed' | 'provisional' | 'reverted' | 'skipped';

export interface RuntimeFixReport {
  status: RuntimeFixStatus;
  reason: string;
  attempts: number;
  filePath?: string;
  lineNumber?: number;
  before?: string;
  after?: string;
  // provisional fixes: what to restore if the error comes back
  original?: string;
  fixedContent?: string;
  call?: FixCall;
  lastAttempt?: RuntimeAttempt;
}

interface ContextFile {
  filePath: string;
  lines: string[];
  eol: string;
  original: string;
  // the stack line in this file (null = imported by a test, shown from the top)
  focus: number | null;
}

async function loadContexts(error: RuntimeError): Promise<ContextFile[]> {
  const contexts: ContextFile[] = [];
  const add = async (filePath: string, focus: number | null): Promise<void> => {
    if (contexts.length >= MAX_CONTEXT_FILES || contexts.some((item) => item.filePath === filePath)) return;
    const content = await readFile(filePath);
    if (content === null) return;
    const { lines, eol } = splitFile(content);
    contexts.push({ filePath, lines, eol, original: content, focus });
  };

  for (const frame of error.frames) await add(frame.filePath, frame.lineIndex);
  // a failing test usually points only at the test: the code under test is what it imports
  for (const frame of error.frames.filter((item) => isTestFile(item.filePath))) {
    const content = (await readFile(frame.filePath)) ?? '';
    for (const imported of resolveLocalImports(frame.filePath, content)) {
      const relative = path.relative(process.cwd(), path.resolve(imported)).split(path.sep).join('/');
      if (!isTestFile(relative)) await add(relative, null);
    }
  }
  return contexts;
}

function describeContext(context: ContextFile): string {
  const role = isTestFile(context.filePath) ? ' (TESTE: não pode ser alterado)' : '';
  const body =
    context.focus !== null
      ? buildNumberedSnippet(context.lines, context.focus)
      : context.lines
          .slice(0, HEAD_LINES)
          .map((line, index) => `  ${String(index + 1).padStart(3)} | ${line}`)
          .join('\n');
  return `=== ${context.filePath}${role} ===\n${body}`;
}

function buildRuntimePrompt(error: RuntimeError, contexts: ContextFile[], previous?: RuntimeAttempt): string {
  const stack = error.frames.map((frame) => `- ${frame.filePath}:${frame.lineIndex + 1}${frame.fn ? ` (${frame.fn})` : ''}`).join('\n');
  const retry = previous ? `\nTentativa anterior (REJEITADA, não repita):\n${previous.line}\nMotivo: ${previous.reason}\n` : '';

  return `Você corrige um erro de execução (runtime) em um projeto TypeScript/JavaScript mudando UMA linha.

Erro: ${error.type}: ${error.message}

Stack (arquivos do projeto, do mais interno para fora):
${stack}

Saída original:
${truncateForPrompt(error.raw, MAX_RAW_CHARS)}

Arquivos (linhas numeradas; >> marca a linha do stack):
${contexts.map(describeContext).join('\n\n')}
${retry}
REGRAS:
- Encontre a causa (dado que falta, nome errado, cálculo errado) e corrija na linha certa: pode não ser a primeira do stack
- Só pode mudar arquivos que NÃO são de teste. O teste é a especificação: nunca mude o teste para ele passar
- Não esconda o erro: nada de try/catch vazio, any, @ts-ignore, comentar ou apagar a linha. Use ?. ou valor padrão só se o dado puder mesmo faltar
- Se não der para corrigir mudando uma linha, responda só: NAO_DA

Formato exato da resposta:
ARQUIVO: <caminho como na lista>
LINHA: <número>
\`\`\`ts
<a linha corrigida, inteira>
\`\`\``;
}

interface ProposedChange {
  context: ContextFile;
  lineIndex: number;
  newLine: string;
}

function parseAnswer(response: string, contexts: ContextFile[]): ProposedChange | 'unfixable' | null {
  if (/\bNAO_DA\b|\bNÃO_DÁ\b/i.test(response)) return 'unfixable';
  const file = response.match(/ARQUIVO:\s*`?([^\s`]+)`?/i)?.[1]?.replace(/^\.\//, '');
  const line = Number(response.match(/LINHA:\s*(\d+)/i)?.[1]);
  const context = contexts.find((item) => item.filePath === file);
  if (!context || !Number.isInteger(line) || line < 1 || line > context.lines.length) return null;

  const fence = response.slice(response.search(/```/));
  const newLine = parseCorrectedLine(fence, context.lines[line - 1]);
  return newLine ? { context, lineIndex: line - 1, newLine } : null;
}

function safeTypecheck(): TscDiagnostic[] | null {
  try {
    return runTypecheck().diagnostics;
  } catch {
    // not a TypeScript project (or no tsc): this layer is skipped
    return null;
  }
}

// Reruns the failing test, when the error came from one.
async function rerunFailingTest(error: RuntimeError): Promise<{ status: 'passed' | 'failed' | 'none'; output?: string }> {
  const testFile = error.frames.find((frame) => isTestFile(frame.filePath))?.filePath;
  if (!testFile) return { status: 'none' };
  const setup = await detectTestSetup(testFile);
  if (!setup || !hasLocalTestRunner(setup.framework)) return { status: 'none' };
  const result = runTestFile(setup.framework, testFile);
  return { status: result.passed ? 'passed' : 'failed', output: result.output };
}

export async function autoFixRuntimeError(
  error: RuntimeError,
  session: FixBackup[],
  options: { confirmBeforeApply: boolean; previousAttempt?: RuntimeAttempt }
): Promise<RuntimeFixReport> {
  const contexts = await loadContexts(error);
  if (!contexts.some((context) => !isTestFile(context.filePath))) {
    return { status: 'skipped', reason: 'nenhum arquivo do projeto (fora os testes) no stack', attempts: 0 };
  }

  const baseline = safeTypecheck();
  let previous = options.previousAttempt;
  let lastReason = 'nenhuma tentativa';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await askLocal('fix', buildRuntimePrompt(error, contexts, previous), { temperature: attempt === 1 ? 0 : 0.3, maxTokens: MAX_TOKENS });
    const proposal = parseAnswer(response, contexts);
    if (proposal === 'unfixable') return { status: 'skipped', reason: 'o modelo disse que não dá para corrigir mudando uma linha: use "kvasir fix"', attempts: attempt };
    if (!proposal) {
      lastReason = 'a resposta não trouxe arquivo, linha e código válidos';
      continue;
    }

    const { context, lineIndex, newLine } = proposal;
    const oldLine = context.lines[lineIndex];
    const where = `${context.filePath}:${lineIndex + 1}`;

    // Layer 1: the test is the spec, and hiding the error is not fixing it.
    const refused = isTestFile(context.filePath) ? 'tentou mudar o teste em vez do código' : hidingReason(oldLine, newLine);
    if (refused) {
      lastReason = refused;
      await recordOutcome('fix', 'rejected');
      previous = { line: `${where}: ${newLine.trim()}`, reason: refused };
      continue;
    }

    if (options.confirmBeforeApply) {
      console.log(`   ${where}\n   ANTES:  ${oldLine.trim()}\n   DEPOIS: ${newLine.trim()}`);
      if (!(await confirm('Aplicar esta correção?'))) return { status: 'skipped', reason: 'você recusou', attempts: attempt };
    }
    if ((await readFile(context.filePath)) !== context.original) {
      return { status: 'skipped', reason: 'o arquivo mudou enquanto eu corrigia', attempts: attempt };
    }

    await ensureBackup(session, context.filePath);
    const fixedLines = [...context.lines];
    fixedLines[lineIndex] = newLine;
    const fixedContent = fixedLines.join(context.eol);
    await writeFile(context.filePath, fixedContent);
    const executor = peekLastExecutorCall('fix');
    const call = executor ? { id: executor.id, task: executor.task, model: executor.model } : undefined;

    const undo = async (reason: string): Promise<void> => {
      await writeFile(context.filePath, context.original);
      lastReason = reason;
      await recordOutcome('fix', 'rejected');
      previous = { line: `${where}: ${newLine.trim()}`, reason };
    };

    // Layer 2: no new type errors anywhere in the project.
    if (baseline) {
      const newErrors = findNewErrors(baseline, safeTypecheck() ?? baseline);
      if (newErrors.length > 0) {
        await undo(describeNewErrors(newErrors));
        continue;
      }
    }

    // Layer 3: the failing test passes again (confirmed) or the file's tests still pass (provisional).
    const rerun = await rerunFailingTest(error);
    if (rerun.status === 'failed') {
      const same = (rerun.output ?? '').includes(error.message.slice(0, 60));
      await undo(same ? 'o teste continua falhando com o mesmo erro' : `o teste ainda falha: ${(rerun.output ?? '').split('\n').find((line) => /Error|Expected|✕|×/.test(line))?.trim() ?? ''}`);
      continue;
    }
    const confirmed = rerun.status === 'passed';
    if (!confirmed) {
      const related = await runRelatedTests(context.filePath);
      if (related.status === 'failed') {
        await undo(`quebrou o teste ${related.testFile}`);
        continue;
      }
    }

    if (call) await attachCallToBackup(session, context.filePath, call);
    const base = { attempts: attempt, filePath: context.filePath, lineNumber: lineIndex + 1, before: oldLine, after: newLine };
    if (confirmed) {
      await recordOutcome('fix', 'approved');
      await noteFixedError({
        code: error.type,
        message: error.message,
        filePath: context.filePath,
        line: lineIndex + 1,
        before: oldLine,
        after: newLine,
        source: 'kvasir watch (runtime, teste passou)',
      });
      return { ...base, status: 'fixed', reason: 'o teste que falhava passou' };
    }
    return {
      ...base,
      status: 'provisional',
      reason: 'sem teste para repetir o erro: fica provisória e é desfeita se o erro voltar',
      original: context.original,
      fixedContent,
      call,
      lastAttempt: { line: `${where}: ${newLine.trim()}`, reason: 'o erro voltou a acontecer depois desta correção' },
    };
  }

  return { status: 'reverted', reason: lastReason, attempts: MAX_ATTEMPTS, lastAttempt: previous };
}
