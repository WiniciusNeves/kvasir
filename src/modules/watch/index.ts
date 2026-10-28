import path from 'path';
import fs from 'fs';
import { readClipboard } from '@ai/client';
import { queueJobs, clearQueuedJobs } from '@ai/jobs';
import { parseTscDiagnostics, runTypecheck } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { killProcessTree, killTreeWhenParentDies, spawnCommand } from '@utils/process';
import { readUserConfig } from '@utils/userConfig';
import { autoFixDiagnostic } from '@modules/fix/auto';
import { autoFixRuntimeError } from '@modules/fix/runtime';
import type { RuntimeAttempt } from '@modules/fix/runtime';
import type { FixCall } from '@modules/fix/backup';
import { recordOutcomeForCall } from '@ai/metrics';
import { readFile, writeFile } from '@utils/fs';
import { parseRuntimeErrors, isTestFile, stripAnsi } from '@utils/runtimeErrors';
import type { RuntimeError } from '@utils/runtimeErrors';
import type { FixBackup } from '@modules/fix/backup';

// kvasir watch: finds TypeScript errors (copied to the clipboard, or printed by a command it runs)
// and fixes them on its own, validating each fix and undoing what does not pass (modules/fix/auto).
// Never commits, pushes or installs anything.

const CLIPBOARD_POLL_MS = 1500;
// output quiet for this long = the compiler finished a round
const OUTPUT_SETTLE_MS = 1500;
// a file touched less than this ago is probably being edited
const FILE_IDLE_MS = 3000;
const FILE_IDLE_MAX_WAIT_MS = 30_000;
const MAX_ATTEMPTS_PER_ERROR = 3;
const MAX_BUFFER_CHARS = 200_000;
// fix → recheck → fix what is left; a cap so a stubborn project cannot loop forever
const MAX_ROUNDS = 5;
// how bundlers announce a failed build (Metro, webpack/Next, Vite, esbuild)
const BUILD_FAILED = /Bundling failed|Unable to resolve (module )?["'.]|Module not found|Failed to compile|Build failed|\[vite\].*error/i;

// A runtime fix with no test to rerun: kept, and undone if the same error shows up again.
interface PendingRuntimeFix {
  label: string;
  filePath: string;
  original: string;
  fixedContent: string;
  call?: FixCall;
  attempt?: RuntimeAttempt;
}

interface WatchSession {
  backups: FixBackup[];
  attemptsByError: Map<string, number>;
  busy: boolean;
  confirmBeforeApply: boolean;
  fixed: number;
  reverted: number;
  // runtime: provisional fixes by error signature, and the last rejected attempt to tell the model
  pending: Map<string, PendingRuntimeFix>;
  lastRuntimeAttempt: Map<string, RuntimeAttempt>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The line is part of the key: the same mistake twice in a file gives two errors with the same message.
function errorKey(diagnostic: TscDiagnostic): string {
  return `${path.resolve(diagnostic.filePath).toLowerCase()}|${diagnostic.lineIndex}|${diagnostic.code}|${diagnostic.message}`;
}

// Only project source files: never node_modules, build output or anything outside the folder.
function isProjectFile(filePath: string): boolean {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  if (/(^|[\\/])(node_modules|dist|build|\.next|\.expo)[\\/]/.test(relative)) return false;
  return fs.existsSync(absolute);
}

async function waitUntilIdle(filePath: string): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < FILE_IDLE_MAX_WAIT_MS) {
    const modified = fs.statSync(filePath).mtimeMs;
    if (Date.now() - modified >= FILE_IDLE_MS) return true;
    await wait(500);
  }
  return false;
}

// A cascade usually has one cause: per file, only the first error is fixed, then everything is rechecked.
function pickTargets(diagnostics: TscDiagnostic[], session: WatchSession): TscDiagnostic[] {
  const byFile = new Map<string, TscDiagnostic>();
  for (const diagnostic of diagnostics) {
    const file = path.resolve(diagnostic.filePath).toLowerCase();
    if (byFile.has(file) || !isProjectFile(diagnostic.filePath)) continue;
    if ((session.attemptsByError.get(errorKey(diagnostic)) ?? 0) >= MAX_ATTEMPTS_PER_ERROR) continue;
    byFile.set(file, diagnostic);
  }
  return [...byFile.values()];
}

async function processErrors(found: TscDiagnostic[], session: WatchSession): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    // The printed list can be partial or old: the project's own typecheck is the truth.
    let baseline: TscDiagnostic[];
    try {
      baseline = runTypecheck().diagnostics;
    } catch (error) {
      console.log(`⚠️  Não consegui rodar o typecheck para validar: ${(error as Error).message}`);
      return;
    }
    const stillThere = found.filter((item) => baseline.some((diagnostic) => errorKey(diagnostic) === errorKey(item)));
    // Rounds: fix the first error of each file, recheck, repeat with what is left (the compiler's own
    // output about our fixes is ignored while busy, so the loop must not wait for it).
    const triedNow = new Set<string>();
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const pool = round === 0 && stillThere.length > 0 ? stillThere : baseline;
      const targets = pickTargets(pool.filter((diagnostic) => !triedNow.has(errorKey(diagnostic))), session);
      if (targets.length === 0) {
        if (round === 0 && baseline.length === 0 && found.length === 0) {
          console.log('⏭️  O typecheck não vê erro: esse erro do build eu não sei corrigir sozinho. Copie a mensagem para o "kvasir fix".');
        } else {
          console.log(baseline.length === 0 ? '✅ O typecheck não tem mais erros.' : `Sobraram ${baseline.length} erro(s) que não consigo corrigir sozinho.`);
        }
        break;
      }

      console.log(`\n🔴 ${baseline.length} erro(s) no projeto. Corrigindo ${targets.length} (o primeiro de cada arquivo)...`);
      queueJobs('fix', targets.map((diagnostic) => `${diagnostic.code} em ${diagnostic.filePath}:${diagnostic.lineIndex + 1}`));
      targets.forEach((target) => triedNow.add(errorKey(target)));
      baseline = await fixTargets(targets, baseline, session);
      clearQueuedJobs('fix');
    }

    if (session.fixed > 0) console.log(`   Desfazer tudo o que o watch mudou: kvasir fix --undo`);
  } finally {
    clearQueuedJobs('fix');
    session.busy = false;
  }
}

// Returns the project's diagnostics after the fixes that stuck.
async function fixTargets(targets: TscDiagnostic[], start: TscDiagnostic[], session: WatchSession): Promise<TscDiagnostic[]> {
  let baseline = start;
  for (const target of targets) {
    const label = `${target.code} em ${target.filePath}:${target.lineIndex + 1}`;
    const key = errorKey(target);
    session.attemptsByError.set(key, (session.attemptsByError.get(key) ?? 0) + 1);

    if (!(await waitUntilIdle(target.filePath))) {
      console.log(`⏸️  ${label}: o arquivo não parou de mudar, deixo para a próxima.`);
      continue;
    }

    const report = await autoFixDiagnostic(target, session.backups, baseline, { confirmBeforeApply: session.confirmBeforeApply });
    if (report.status === 'fixed') {
      session.fixed += 1;
      baseline = report.diagnostics ?? baseline;
      console.log(`✅ ${label}: corrigido e validado (${report.reason})`);
      console.log(`   ${report.before?.trim()}  →  ${report.after?.trim()}`);
    } else if (report.status === 'reverted') {
      session.reverted += 1;
      console.log(`↩️  ${label}: não consegui corrigir com segurança (${report.reason}). O arquivo ficou como estava.`);
    } else {
      console.log(`⏭️  ${label}: ${report.reason}`);
    }

    if ((session.attemptsByError.get(key) ?? 0) >= MAX_ATTEMPTS_PER_ERROR && report.status !== 'fixed') {
      console.log(`🛑 ${label}: parei de tentar (${MAX_ATTEMPTS_PER_ERROR} tentativas). Rode "kvasir fix" para investigar a causa.`);
    }
  }
  return baseline;
}

// The same error after a provisional fix: the fix did not work, put the file back.
async function undoIfBack(error: RuntimeError, session: WatchSession): Promise<void> {
  const pending = session.pending.get(error.signature);
  if (!pending) return;
  session.pending.delete(error.signature);

  if ((await readFile(pending.filePath)) !== pending.fixedContent) {
    console.log(`⚠️  ${pending.label}: o erro voltou, mas o arquivo já mudou depois da minha correção; não desfiz.`);
    return;
  }
  await writeFile(pending.filePath, pending.original);
  if (pending.call) await recordOutcomeForCall(pending.call, 'rejected');
  if (pending.attempt) session.lastRuntimeAttempt.set(error.signature, pending.attempt);
  session.fixed -= 1;
  session.reverted += 1;
  console.log(`↩️  ${pending.label}: o erro voltou a acontecer, desfiz a correção provisória.`);
}

async function processRuntimeErrors(errors: RuntimeError[], session: WatchSession): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  try {
    for (const error of errors) await undoIfBack(error, session);

    const targets = errors.filter((error) => (session.attemptsByError.get(error.signature) ?? 0) < MAX_ATTEMPTS_PER_ERROR);
    if (targets.length === 0) return;
    console.log(`\n🔴 ${targets.length} erro(s) de execução. Corrigindo...`);
    queueJobs('fix', targets.map((error) => `${error.type} em ${error.frames[0].filePath}:${error.frames[0].lineIndex + 1}`));

    // a confirmed fix reran the whole test file and it passed: its other failures are gone too
    const passedTestFiles = new Set<string>();
    for (const error of targets) {
      const frame = error.frames.find((item) => !isTestFile(item.filePath)) ?? error.frames[0];
      const label = `${error.type} (${error.message.slice(0, 60)}) em ${frame.filePath}:${frame.lineIndex + 1}`;
      const testFile = error.frames.find((item) => isTestFile(item.filePath))?.filePath;
      if (testFile && passedTestFiles.has(testFile)) {
        console.log(`✅ ${label}: resolvido pela correção anterior (${testFile} passou inteiro)`);
        continue;
      }
      session.attemptsByError.set(error.signature, (session.attemptsByError.get(error.signature) ?? 0) + 1);

      if (!(await waitUntilIdle(frame.filePath))) {
        console.log(`⏸️  ${label}: o arquivo não parou de mudar, deixo para a próxima.`);
        continue;
      }

      const report = await autoFixRuntimeError(error, session.backups, {
        confirmBeforeApply: session.confirmBeforeApply,
        previousAttempt: session.lastRuntimeAttempt.get(error.signature),
      });
      const compact = (text = ''): string => text.split('\n').map((line) => line.trim()).join(' ');
      const change = report.before !== undefined ? `\n   ${report.filePath}:${report.lineNumber}  ${compact(report.before)}  →  ${compact(report.after)}` : '';
      if (report.status === 'fixed') {
        session.fixed += 1;
        if (testFile) passedTestFiles.add(testFile);
        console.log(`✅ ${label}: corrigido e confirmado (${report.reason})${change}`);
      } else if (report.status === 'provisional') {
        session.fixed += 1;
        session.pending.set(error.signature, {
          label,
          filePath: report.filePath ?? frame.filePath,
          original: report.original ?? '',
          fixedContent: report.fixedContent ?? '',
          call: report.call,
          attempt: report.lastAttempt,
        });
        console.log(`🟡 ${label}: corrigido provisoriamente (${report.reason})${change}`);
      } else if (report.status === 'reverted') {
        session.reverted += 1;
        if (report.lastAttempt) session.lastRuntimeAttempt.set(error.signature, report.lastAttempt);
        console.log(`↩️  ${label}: não consegui corrigir com segurança (${report.reason}). O arquivo ficou como estava.`);
      } else {
        console.log(`⏭️  ${label}: ${report.reason}`);
      }
    }
    if (session.fixed > 0) console.log('   Desfazer tudo o que o watch mudou: kvasir fix --undo');
  } finally {
    clearQueuedJobs('fix');
    session.busy = false;
  }
}

// Type errors first (a project that does not compile has no useful runtime errors), then runtime ones.
async function handleText(text: string, session: WatchSession): Promise<void> {
  const diagnostics = parseTscDiagnostics(text);
  if (diagnostics.length > 0) {
    await processErrors(diagnostics, session);
    return;
  }
  const runtime = parseRuntimeErrors(text);
  if (runtime.length > 0) {
    await processRuntimeErrors(runtime, session);
    return;
  }
  // A bundler's build error (Metro, webpack, Next) has its own format, but a missing module or a
  // broken import is also a type error: the project's typecheck finds it in a format we fix.
  if (BUILD_FAILED.test(stripAnsi(text)) && !session.busy) {
    console.log('\n🔎 O build falhou. Conferindo o typecheck do projeto...');
    await processErrors([], session);
  }
}

async function watchClipboard(session: WatchSession): Promise<void> {
  console.log('👀 Vigiando o clipboard: copie um erro (do TypeScript ou de execução, com o stack) e eu corrijo. Ctrl+C para parar.');
  let last = (await readClipboard().catch(() => '')).trim();

  for (;;) {
    await wait(CLIPBOARD_POLL_MS);
    const text = (await readClipboard().catch(() => '')).trim();
    if (!text || text === last) continue;
    last = text;

    await handleText(text, session);
  }
}

async function watchCommand(command: string[], session: WatchSession): Promise<void> {
  const [bin, ...args] = command;
  console.log(`👀 Rodando "${command.join(' ')}" e corrigindo os erros que aparecerem (TypeScript e de execução). Ctrl+C para parar.\n`);

  const child = spawnCommand(bin, args);
  const childPid = child.pid;
  if (childPid) {
    killTreeWhenParentDies(childPid);
    process.on('exit', () => killProcessTree(childPid));
  }

  let buffer = '';
  let timer: NodeJS.Timeout | null = null;

  const onSettled = (): void => {
    const text = buffer;
    buffer = '';
    void handleText(text, session);
  };

  const onOutput = (chunk: Buffer, stream: NodeJS.WriteStream): void => {
    stream.write(chunk);
    // output caused by our own fixes is rechecked by the typecheck anyway
    if (session.busy) return;
    buffer = (buffer + chunk.toString('utf-8')).slice(-MAX_BUFFER_CHARS);
    if (timer) clearTimeout(timer);
    timer = setTimeout(onSettled, OUTPUT_SETTLE_MS);
  };

  child.stdout?.on('data', (chunk: Buffer) => onOutput(chunk, process.stdout));
  child.stderr?.on('data', (chunk: Buffer) => onOutput(chunk, process.stderr));

  const code = await new Promise<number | null>((resolve) => {
    child.on('exit', resolve);
    child.on('error', (error) => {
      console.log(`❌ Não consegui rodar "${command.join(' ')}": ${error.message}`);
      resolve(1);
    });
  });

  // a one-shot command (tsc --noEmit): its last output may still be waiting
  if (timer) clearTimeout(timer);
  if (buffer) {
    const text = buffer;
    buffer = '';
    await handleText(text, session);
  }
  while (session.busy) await wait(200);
  console.log(`\nO comando terminou (código ${code ?? '?'}). ${session.fixed} corrigido(s), ${session.reverted} desfeito(s).`);
  if (session.pending.size > 0) {
    console.log(`🟡 ${session.pending.size} correção(ões) provisória(s) ficaram (o erro não voltou enquanto eu olhava). Confira; para desfazer: kvasir fix --undo`);
  }
}

export async function runWatch(command: string[] = []): Promise<void> {
  const autonomy = (await readUserConfig()).ai?.autonomy ?? 2;
  const session: WatchSession = {
    backups: [],
    attemptsByError: new Map(),
    busy: false,
    confirmBeforeApply: autonomy === 1,
    fixed: 0,
    reverted: 0,
    pending: new Map(),
    lastRuntimeAttempt: new Map(),
  };

  console.log(
    autonomy === 1
      ? '🔒 Autonomia 1: mostro cada correção e pergunto antes de aplicar.'
      : '⚡ Autonomia 2: corrijo, valido (todos os erros antes × depois, testes do arquivo) e desfaço o que não passar.'
  );

  if (command.length > 0) await watchCommand(command, session);
  else await watchClipboard(session);
}
