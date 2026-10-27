import { askLocal } from '@ai/router';
import { recordOutcome, peekLastExecutorCall } from '@ai/metrics';
import { readFile, writeFile } from '@utils/fs';
import { confirm } from '@utils/prompt';
import { runTypecheck } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { noteFixedError, knownFixesFor } from '@modules/knowledge/auto';
import { ensureBackup, attachCallToBackup } from './backup';
import type { FixBackup } from './backup';
import { splitFile, applyDeterministicFix, buildLineFixPrompt, lineFixContextQuery, parseCorrectedLine, COMPLEX_CODES } from './line';
import { relatedContext } from '@modules/omnicontext/context';
import { listSiblingImports } from '@utils/imports';
import type { LineFixContext } from './line';
import { hidingReason, compareDiagnostics, runRelatedTests } from './validate';

// One error fixed without asking (kvasir watch): rule or AI → hide check → apply → every error of the
// project before × after → tests of the file → keep, or undo and try once more telling the model why
// it failed. The validation result is the model's verdict in the metrics.

const MAX_ATTEMPTS = 2;
const KNOWN_FIXES_IN_PROMPT = 3;
const LINE_FIX_MAX_TOKENS = 256;

export type AutoFixStatus = 'fixed' | 'reverted' | 'skipped';

export interface AutoFixReport {
  status: AutoFixStatus;
  reason: string;
  attempts: number;
  before?: string;
  after?: string;
  // the project's diagnostics after this fix (the next baseline)
  diagnostics?: TscDiagnostic[];
}

export interface AutoFixOptions {
  // autonomy 1: show the change and ask before writing
  confirmBeforeApply: boolean;
}

async function proposeLine(diagnostic: TscDiagnostic, lines: string[], attempt: number, context: LineFixContext): Promise<{ line: string | null; source: string }> {
  if (attempt === 1) {
    const deterministic = applyDeterministicFix(lines[diagnostic.lineIndex], diagnostic);
    if (deterministic) return { line: deterministic, source: 'regra determinística' };
  }
  const response = await askLocal('fix', buildLineFixPrompt(diagnostic, lines, context), { temperature: attempt === 1 ? 0 : 0.3, maxTokens: LINE_FIX_MAX_TOKENS });
  return { line: parseCorrectedLine(response, lines[diagnostic.lineIndex]), source: 'IA' };
}

// TS2307 "Cannot find module '@utils/x'" on the line that imports it, for a module of this project.
function projectImportsFor(diagnostic: TscDiagnostic, line: string): string[] {
  if (diagnostic.code !== 'TS2307') return [];
  const specifier = diagnostic.message.match(/'([^']+)'/)?.[1];
  if (!specifier || !line.includes(specifier)) return [];
  return listSiblingImports(specifier, diagnostic.filePath);
}

async function reject(source: string): Promise<void> {
  if (source === 'IA') await recordOutcome('fix', 'rejected');
}

export async function autoFixDiagnostic(
  diagnostic: TscDiagnostic,
  session: FixBackup[],
  baseline: TscDiagnostic[],
  options: AutoFixOptions
): Promise<AutoFixReport> {
  const original = await readFile(diagnostic.filePath);
  if (original === null) return { status: 'skipped', reason: 'arquivo não encontrado', attempts: 0 };

  const { lines, eol } = splitFile(original);
  const oldLine = lines[diagnostic.lineIndex];
  if (oldLine === undefined) return { status: 'skipped', reason: `a linha ${diagnostic.lineIndex + 1} não existe mais`, attempts: 0 };

  // Complex errors usually live outside the reported line: only proven rules touch them here. The
  // exception is a project import that does not resolve, when the real ones next to it are known.
  const existingImports = projectImportsFor(diagnostic, oldLine);
  const complex = COMPLEX_CODES.test(diagnostic.code) && !applyDeterministicFix(oldLine, diagnostic) && existingImports.length === 0;
  if (complex) return { status: 'skipped', reason: 'erro complexo (a causa costuma estar fora da linha): rode "kvasir fix" para investigar', attempts: 0 };

  const { query, shown } = lineFixContextQuery(diagnostic, lines);
  const context: LineFixContext = {
    knownFixes: await knownFixesFor(diagnostic.code, KNOWN_FIXES_IN_PROMPT),
    projectContext: await relatedContext(query, { exclude: [shown] }),
    existingImports,
  };
  let lastReason = 'nenhuma tentativa';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { line: newLine, source } = await proposeLine(diagnostic, lines, attempt, context);
    if (!newLine || newLine === oldLine) {
      lastReason = 'a IA não devolveu uma linha válida';
      continue;
    }

    // Layer 1: hiding the error is not fixing it (rejected before touching the file).
    const hiding = hidingReason(oldLine, newLine);
    if (hiding) {
      lastReason = hiding;
      await reject(source);
      context.previousAttempt = { line: newLine, reason: hiding };
      continue;
    }

    if (options.confirmBeforeApply) {
      console.log(`   ANTES:  ${oldLine.trim()}\n   DEPOIS: ${newLine.trim()}`);
      if (!(await confirm('Aplicar esta correção?'))) return { status: 'skipped', reason: 'você recusou', attempts: attempt };
    }

    // The user may be editing the file: never write over a version we did not read.
    if ((await readFile(diagnostic.filePath)) !== original) {
      return { status: 'skipped', reason: 'o arquivo mudou enquanto eu corrigia (tento de novo no próximo erro)', attempts: attempt };
    }

    await ensureBackup(session, diagnostic.filePath);
    const fixedLines = [...lines];
    fixedLines[diagnostic.lineIndex] = newLine;
    await writeFile(diagnostic.filePath, fixedLines.join(eol));
    const call = source === 'IA' ? peekLastExecutorCall('fix') : undefined;

    // Layer 2: every error of the project, before × after.
    const after = runTypecheck().diagnostics;
    const comparison = compareDiagnostics(baseline, after, diagnostic);
    if (!comparison.ok) {
      await writeFile(diagnostic.filePath, original);
      lastReason = comparison.reason;
      await reject(source);
      context.previousAttempt = { line: newLine, reason: comparison.reason };
      continue;
    }

    // Layer 3: the tests of this file. A test that already failed before the fix does not count against it.
    const tests = await runRelatedTests(diagnostic.filePath);
    let testNote = tests.status === 'passed' ? ', testes ok' : '';
    if (tests.status === 'failed') {
      await writeFile(diagnostic.filePath, original);
      const beforeFix = await runRelatedTests(diagnostic.filePath);
      if (beforeFix.status === 'failed') {
        await writeFile(diagnostic.filePath, fixedLines.join(eol));
        testNote = ', testes já falhavam antes';
      } else {
        lastReason = `quebrou o teste ${tests.testFile}`;
        await reject(source);
        context.previousAttempt = { line: newLine, reason: `${lastReason}:\n${(tests.output ?? '').slice(-600)}` };
        continue;
      }
    }

    if (source === 'IA') await recordOutcome('fix', 'approved');
    if (call) await attachCallToBackup(session, diagnostic.filePath, { id: call.id, task: call.task, model: call.model });
    await noteFixedError({
      code: diagnostic.code,
      message: diagnostic.message,
      filePath: diagnostic.filePath,
      line: diagnostic.lineIndex + 1,
      before: oldLine,
      after: newLine,
      source: `kvasir watch (${source}, validado)`,
    });
    return { status: 'fixed', reason: `${comparison.reason}${testNote}`, attempts: attempt, before: oldLine, after: newLine, diagnostics: after };
  }

  return { status: 'reverted', reason: lastReason, attempts: MAX_ATTEMPTS };
}
