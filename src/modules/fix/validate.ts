import path from 'path';
import fs from 'fs-extra';
import type { TscDiagnostic } from '@utils/typecheck';
import { hasLocalTestRunner, runTestFile } from '@utils/testRunner';
import { detectTestSetup } from '@modules/test/framework';

// Validation layers of an automatic fix (kvasir watch). "The error is gone" is not enough: a fix
// that hides the error, breaks something else or breaks a test is rejected and undone.

// 1. Hiding the error instead of fixing it. A quality gate on the model's output, not a workaround:
// the prompt asks for the same, this only refuses an answer that ignored it.
const HIDING_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /@ts-(ignore|expect-error|nocheck)\b/, reason: 'escondeu o erro com @ts-ignore/@ts-expect-error' },
  { pattern: /eslint-disable/, reason: 'desligou o lint (eslint-disable)' },
  { pattern: /\bas\s+any\b|:\s*any\b|<any>/, reason: 'usou any para calar o compilador' },
  { pattern: /\bas\s+unknown\s+as\b/, reason: 'usou "as unknown as" para forçar o tipo' },
  { pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/, reason: 'engoliu o erro com um catch vazio' },
];

function isComment(line: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(line);
}

export function hidingReason(oldLine: string, newLine: string): string | null {
  if (!newLine.trim()) return 'apagou a linha em vez de corrigir';
  if (isComment(newLine) && !isComment(oldLine)) return 'comentou a linha em vez de corrigir';
  const found = HIDING_PATTERNS.find(({ pattern }) => pattern.test(newLine) && !pattern.test(oldLine));
  return found ? found.reason : null;
}

// 2. Every error of the project before × after (not just the one being fixed).
export interface DiagnosticComparison {
  ok: boolean;
  reason: string;
  targetFixed: boolean;
  newErrors: TscDiagnostic[];
}

function normalize(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

// A one-line fix keeps the line numbers, but messages are compared without them anyway.
function key(diagnostic: TscDiagnostic): string {
  return `${normalize(diagnostic.filePath)}|${diagnostic.code}|${diagnostic.message}`;
}

// Errors in `after` that were not in `before` (counted: two equal errors are two).
export function findNewErrors(before: TscDiagnostic[], after: TscDiagnostic[]): TscDiagnostic[] {
  const remaining = new Map<string, number>();
  for (const diagnostic of before) remaining.set(key(diagnostic), (remaining.get(key(diagnostic)) ?? 0) + 1);
  const newErrors: TscDiagnostic[] = [];
  for (const diagnostic of after) {
    const count = remaining.get(key(diagnostic)) ?? 0;
    if (count > 0) remaining.set(key(diagnostic), count - 1);
    else newErrors.push(diagnostic);
  }
  return newErrors;
}

export function describeNewErrors(newErrors: TscDiagnostic[]): string {
  const first = newErrors[0];
  return `criou ${newErrors.length} erro(s) novo(s), ex.: ${first.code} em ${first.filePath}:${first.lineIndex + 1}: ${first.message}`;
}

export function compareDiagnostics(before: TscDiagnostic[], after: TscDiagnostic[], target: TscDiagnostic): DiagnosticComparison {
  const targetFixed = !after.some(
    (diagnostic) => normalize(diagnostic.filePath) === normalize(target.filePath) && diagnostic.code === target.code && diagnostic.lineIndex === target.lineIndex
  );
  const newErrors = findNewErrors(before, after);

  if (!targetFixed) return { ok: false, reason: 'o erro continua', targetFixed, newErrors };
  if (newErrors.length > 0) return { ok: false, reason: describeNewErrors(newErrors), targetFixed, newErrors };
  return { ok: true, reason: `erros no projeto: ${before.length} → ${after.length}`, targetFixed, newErrors };
}

// 3. The tests of the file that was changed, when they exist.
export type TestStatus = 'none' | 'passed' | 'failed';

export interface RelatedTests {
  status: TestStatus;
  testFile?: string;
  output?: string;
}

function candidateTestFiles(sourceFile: string): string[] {
  const parsed = path.parse(sourceFile);
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  return extensions.flatMap((extension) =>
    ['test', 'spec'].flatMap((kind) => [
      path.join(parsed.dir, `${parsed.name}.${kind}${extension}`),
      path.join(parsed.dir, '__tests__', `${parsed.name}.${kind}${extension}`),
    ])
  );
}

export async function runRelatedTests(sourceFile: string): Promise<RelatedTests> {
  const testFile = candidateTestFiles(sourceFile).find((file) => fs.pathExistsSync(file));
  if (!testFile) return { status: 'none' };

  const setup = await detectTestSetup(sourceFile);
  if (!setup || !hasLocalTestRunner(setup.framework)) return { status: 'none' };

  const result = runTestFile(setup.framework, testFile.replace(/\\/g, '/'));
  return { status: result.passed ? 'passed' : 'failed', testFile, output: result.output };
}
