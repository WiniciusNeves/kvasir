import path from 'path';
import fs from 'fs';
import { readClipboard } from '@ai/client';
import { queueJobs, clearQueuedJobs } from '@ai/jobs';
import { parseTscDiagnostics, runTypecheck } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { spawnCommand } from '@utils/process';
import { readUserConfig } from '@utils/userConfig';
import { autoFixDiagnostic } from '@modules/fix/auto';
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

interface WatchSession {
  backups: FixBackup[];
  attemptsByError: Map<string, number>;
  busy: boolean;
  confirmBeforeApply: boolean;
  fixed: number;
  reverted: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorKey(diagnostic: TscDiagnostic): string {
  return `${path.resolve(diagnostic.filePath).toLowerCase()}|${diagnostic.code}|${diagnostic.message}`;
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
        console.log(baseline.length === 0 ? '✅ O typecheck não tem mais erros.' : `Sobraram ${baseline.length} erro(s) que não consigo corrigir sozinho.`);
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

async function watchClipboard(session: WatchSession): Promise<void> {
  console.log('👀 Vigiando o clipboard: copie um erro do TypeScript e eu corrijo. Ctrl+C para parar.');
  let last = (await readClipboard().catch(() => '')).trim();

  for (;;) {
    await wait(CLIPBOARD_POLL_MS);
    const text = (await readClipboard().catch(() => '')).trim();
    if (!text || text === last) continue;
    last = text;

    const diagnostics = parseTscDiagnostics(text);
    if (diagnostics.length > 0) await processErrors(diagnostics, session);
  }
}

async function watchCommand(command: string[], session: WatchSession): Promise<void> {
  const [bin, ...args] = command;
  console.log(`👀 Rodando "${command.join(' ')}" e corrigindo os erros do TypeScript que aparecerem. Ctrl+C para parar.\n`);

  const child = spawnCommand(bin, args);
  process.on('exit', () => child.kill());

  let buffer = '';
  let timer: NodeJS.Timeout | null = null;

  const onSettled = (): void => {
    const diagnostics = parseTscDiagnostics(buffer);
    buffer = '';
    if (diagnostics.length > 0) void processErrors(diagnostics, session);
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
    const diagnostics = parseTscDiagnostics(buffer);
    buffer = '';
    if (diagnostics.length > 0) await processErrors(diagnostics, session);
  }
  while (session.busy) await wait(200);
  console.log(`\nO comando terminou (código ${code ?? '?'}). ${session.fixed} corrigido(s), ${session.reverted} desfeito(s).`);
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
  };

  console.log(
    autonomy === 1
      ? '🔒 Autonomia 1: mostro cada correção e pergunto antes de aplicar.'
      : '⚡ Autonomia 2: corrijo, valido (todos os erros antes × depois, testes do arquivo) e desfaço o que não passar.'
  );

  if (command.length > 0) await watchCommand(command, session);
  else await watchClipboard(session);
}
