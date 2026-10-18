import path from 'path';
import { askFor, askLocal } from '@ai/router';
import { queueJobs, clearQueuedJobs } from '@ai/jobs';
import type { AiTask } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { readClipboard } from '@ai/client';
import { cleanAnswer, truncateForPrompt } from '@ai/parse';
import { input, confirm, select } from '@utils/prompt';
import { loadContext } from '@modules/init/ensure';
import { recordFeedback } from '@utils/feedback';
import { readFile, writeFile, readJson } from '@utils/fs';
import { runTypecheck, parseTscDiagnostics } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { openDiffInEditor } from '@utils/editor';
import { noteFixedError, noteBatchFix, noteInvestigation, recentErrorOccurrences, knownFixesFor } from '@modules/knowledge/auto';
import { readNote } from '@modules/knowledge/notes';
import { ensureBackup, undoLastFix } from './backup';
import type { FixBackup } from './backup';
import { splitFile, applyDeterministicFix, buildNumberedSnippet, buildLineFixPrompt, parseCorrectedLine, DETERMINISTIC_FIXES, COMPLEX_CODES } from './line';
import { resolveLocalImports, readTsconfigText, findFilesNamedLike, isResolvableImport } from '@utils/imports';

const MAX_INVESTIGATION_ROUNDS = 3;
// deepseek-r1 thinks for a long time with a big context; the default 120s cut it off.
const ARCHITECT_TIMEOUT_MS = 300_000;
const MAX_LISTED_DIAGNOSTICS = 10;
const KNOWN_FIXES_IN_PROMPT = 3;
const LINE_FIX_MAX_TOKENS = 256;

type ErrorSource = 'clipboard' | 'typecheck' | 'type';
// interactive: AI via askFor (Claude orchestrates) · batch: local model only · rules-only: deterministic rules only
type FixMode = 'interactive' | 'batch' | 'rules-only';

export interface FixOptions {
  undo?: boolean;
}


interface AppliedFix {
  diagnostic: TscDiagnostic;
  backupPath: string;
  before: string;
  after: string;
  source: string;
}



// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Multi-line errors can't go through `input()` (single-line: the rest leaked into the next prompts),
// so the default is to read what the user copied.
function showClipboardPreview(text: string): void {
  const lines = text.split('\n');
  console.log(`\n📋 Erro lido do clipboard:\n${lines.slice(0, 3).join('\n')}${lines.length > 3 ? '\n…' : ''}`);
}

// "Erro de código corrige direto sem perguntar": if the clipboard already holds a tsc error, use it.
async function readErrorInput(): Promise<string> {
  const clipboard = (await readClipboard()).trim();
  if (parseTscDiagnostics(clipboard).length > 0) {
    showClipboardPreview(clipboard);
    return clipboard;
  }

  const source = await select<ErrorSource>('De onde vem o erro?', [
    { name: 'Clipboard: copie o erro e escolha esta opção', value: 'clipboard' },
    { name: 'Rodar o typecheck e corrigir o primeiro erro', value: 'typecheck' },
    { name: 'Digitar/colar uma única linha', value: 'type' },
  ]);

  if (source === 'type') return input('Cole o erro:');

  if (source === 'typecheck') {
    console.log('\n🔍 Rodando typecheck...');
    const typecheck = runTypecheck();
    if (typecheck.success) {
      console.log('✅ O typecheck não encontrou erros.');
      return '';
    }
    return typecheck.output;
  }

  const text = (await readClipboard()).trim();
  if (!text) throw new Error('O clipboard está vazio. Copie o erro e rode "kvasir fix" de novo.');

  showClipboardPreview(text);
  return text;
}

// ---------------------------------------------------------------------------
// Line fixes: deterministic rules first, AI second
// ---------------------------------------------------------------------------


async function askLineFix(diagnostic: TscDiagnostic, lines: string[], mode: FixMode): Promise<string | null> {
  const prompt = buildLineFixPrompt(diagnostic, lines, { knownFixes: await knownFixesFor(diagnostic.code, KNOWN_FIXES_IN_PROMPT) });
  const options = { temperature: 0, maxTokens: LINE_FIX_MAX_TOKENS };
  const response = mode === 'interactive' ? await askFor('fix', prompt, options) : await askLocal('fix', prompt, options);

  const fixed = parseCorrectedLine(response, lines[diagnostic.lineIndex]);
  if (!fixed) {
    console.log('\n⚠️  A IA não devolveu uma linha válida. Resposta recebida:');
    console.log(response.trim());
  }
  return fixed;
}

function showLineDiff(diagnostic: TscDiagnostic, oldLine: string, newLine: string, source: string): void {
  console.log(`\n📋 ${diagnostic.filePath}:${diagnostic.lineIndex + 1} (${diagnostic.code}, ${source})`);
  console.log('─'.repeat(60));
  console.log(`ANTES:  ${oldLine.trim()}`);
  console.log(`DEPOIS: ${newLine.trim()}`);
  console.log('─'.repeat(60));
}

async function fixDiagnostic(diagnostic: TscDiagnostic, session: FixBackup[], mode: FixMode): Promise<AppliedFix | null> {
  const content = await readFile(diagnostic.filePath);
  if (content === null) {
    console.log(`\n❌ Arquivo não encontrado: ${diagnostic.filePath}. Rode o kvasir na pasta raiz do projeto.`);
    return null;
  }

  const { lines, eol } = splitFile(content);
  if (diagnostic.lineIndex < 0 || diagnostic.lineIndex >= lines.length) {
    console.log(`\n❌ Linha ${diagnostic.lineIndex + 1} não existe em ${diagnostic.filePath}.`);
    return null;
  }

  const oldLine = lines[diagnostic.lineIndex];
  const deterministic = applyDeterministicFix(oldLine, diagnostic);
  const newLine = deterministic ?? (mode === 'rules-only' ? null : await askLineFix(diagnostic, lines, mode));
  if (newLine === null || newLine === oldLine) return null;

  const backupPath = await ensureBackup(session, diagnostic.filePath);
  lines[diagnostic.lineIndex] = newLine;
  await writeFile(diagnostic.filePath, lines.join(eol));

  const source = deterministic ? 'regra determinística' : 'IA';
  showLineDiff(diagnostic, oldLine, newLine, source);
  return { diagnostic, backupPath, before: oldLine, after: newLine, source };
}

// ---------------------------------------------------------------------------
// Errors without a file/line: suggestion or investigation (never written to disk)
// ---------------------------------------------------------------------------

function buildGenericFixPrompt(erro: string): string {
  return `Você é um especialista em TypeScript, React Native e Next.js.
Analise o erro abaixo e sugira a correção.

Erro:
${erro}

Responda em português, exatamente com estas seções:
## Causa
(1-2 frases)

## Solução
(passos objetivos)

## Código corrigido
(só o trecho alterado, sem o arquivo inteiro; não invente arquivos nem caminhos)`;
}

// ---------------------------------------------------------------------------
// Simple × complex. Complex errors usually have their root cause outside the reported line
// (module resolution, config, another file), so they go straight to the architect model.
// ---------------------------------------------------------------------------

type ErrorSeverity = 'simple' | 'complex';

const CONFIG_FILE = /(^|[\\/])(tsconfig[\w.-]*\.json|babel\.config\.\w+|next\.config\.\w+|metro\.config\.\w+|app\.json|package\.json)$/;
const MAX_PASTED_FOR_SIMPLE = 5;

function classifyError(diagnostics: TscDiagnostic[], target: TscDiagnostic): ErrorSeverity {
  const files = new Set(diagnostics.map((diagnostic) => path.resolve(diagnostic.filePath)));
  if (files.size > 1) return 'complex';
  if (diagnostics.length > MAX_PASTED_FOR_SIMPLE) return 'complex';
  if (CONFIG_FILE.test(target.filePath)) return 'complex';
  if (COMPLEX_CODES.test(target.code)) return 'complex';
  if (/tsconfig|babel|moduleResolution|esModuleInterop/i.test(target.message)) return 'complex';
  return 'simple';
}

const MAX_RELATED_FILES = 5;
const MAX_RELATED_LINES = 120;
const VERSION_DEPS = /^(typescript|react|react-native|expo|next|@types\/.+|@tanstack\/.+|zod)$/;

interface PackageJsonVersions {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function describeVersions(): Promise<string> {
  const pkg = await readJson<PackageJsonVersions>('package.json');
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const relevant = Object.entries(deps).filter(([name]) => VERSION_DEPS.test(name));
  return relevant.length > 0 ? relevant.map(([name, version]) => `${name}@${version}`).join(', ') : '(sem package.json)';
}

async function readFileHead(filePath: string): Promise<string | null> {
  const content = await readFile(filePath);
  if (content === null) return null;
  const lines = content.split(/\r?\n/);
  const head = lines.slice(0, MAX_RELATED_LINES).map((line, index) => `${String(index + 1).padStart(4)} | ${line}`);
  return `${head.join('\n')}${lines.length > MAX_RELATED_LINES ? '\n   … (cortado)' : ''}`;
}

// What the architect needs to find a root cause: the file with the error, the files it imports,
// tsconfig.json and the versions of the libraries involved.
async function buildInvestigationContext(erro: string, target: TscDiagnostic | null): Promise<string> {
  const sections = [`Erro colado:\n${erro.trim()}`];

  if (target) {
    const content = await readFile(target.filePath);
    if (content !== null) {
      sections.push(`Arquivo do erro (${target.filePath}), trecho:\n${buildNumberedSnippet(content.split(/\r?\n/), target.lineIndex)}`);

      for (const related of resolveLocalImports(target.filePath, content).slice(0, MAX_RELATED_FILES)) {
        const head = await readFileHead(related);
        if (head) sections.push(`Arquivo relacionado (importado por ${target.filePath}): ${related}\n${head}`);
      }
    }

    // Modules quoted in the error that don't resolve: show what exists with the same name.
    const quotedModules = [...target.message.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    for (const specifier of quotedModules) {
      const isPath = specifier.startsWith('.') || specifier.includes('/');
      if (!isPath || isResolvableImport(specifier, target.filePath)) continue;

      const similar = findFilesNamedLike(specifier);
      sections.push(
        similar.length > 0
          ? `O import '${specifier}' não resolve. Arquivos do projeto com o mesmo nome: ${similar.join(', ')}`
          : `O import '${specifier}' não resolve e nenhum arquivo do projeto tem esse nome.`
      );
    }
  }

  const tsconfig = readTsconfigText();
  sections.push(tsconfig ? `tsconfig.json:\n${tsconfig.trim()}` : 'tsconfig.json: (não existe)');
  sections.push(`Versões: ${await describeVersions()}`);

  return sections.join('\n\n');
}

function buildInvestigationPrompt(context: string): string {
  return `Você é um especialista sênior em TypeScript, React Native e Next.js investigando um erro cuja causa provavelmente NÃO está só na linha apontada.

Pode envolver outro arquivo, erro em cascata, configuração (tsconfig, babel) ou versão de biblioteca.

${context}

Se faltar uma informação essencial, responda APENAS com uma linha:
PERGUNTA: <sua pergunta objetiva>

Senão, responda em português com:
## Causa raiz
(a causa, não o sintoma; cite o arquivo e a linha do contexto acima)

## Arquivos afetados
(só arquivos que aparecem no contexto)

## Correção proposta
(arquivo por arquivo, com o trecho exato a mudar; não invente caminhos)`;
}

function extractQuestion(response: string): string | null {
  const match = response.match(/^PERGUNTA:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

async function investigateComplexError(erro: string, target: TscDiagnostic | null): Promise<string> {
  console.log('\n🟠 Erro complexo: investigando a causa raiz (arquivo, imports, tsconfig e versões)...');
  let context = await buildInvestigationContext(erro, target);

  for (let round = 0; round < MAX_INVESTIGATION_ROUNDS; round += 1) {
    const response = cleanAnswer(await askFor('architect', buildInvestigationPrompt(context), { timeoutMs: ARCHITECT_TIMEOUT_MS }));
    const question = extractQuestion(response);
    if (!question) return response;

    console.log('\n🔎 Kvasir precisa de mais informação para investigar:');
    const answer = await input(question);
    context = `${context}\n\nPergunta: ${question}\nResposta do usuário: ${answer}`;
  }

  return cleanAnswer(await askFor('architect', buildInvestigationPrompt(context), { timeoutMs: ARCHITECT_TIMEOUT_MS }));
}

// ---------------------------------------------------------------------------
// Recurring errors: the same code again and again usually has one cause (config, a project pattern)
// ---------------------------------------------------------------------------

const RECURRING_DAYS = 7;
const RECURRING_THRESHOLD = 3;
const MAX_HISTORY_CHARS = 6_000;

function buildRecurringPrompt(code: string, history: string, tsconfig: string | null, versions: string): string {
  return `Você é um especialista sênior em TypeScript. O erro ${code} apareceu várias vezes nos últimos ${RECURRING_DAYS} dias neste desenvolvedor.

Histórico das ocorrências (o que foi corrigido em cada uma):
${truncateForPrompt(history, MAX_HISTORY_CHARS)}

tsconfig.json:
${tsconfig ?? '(não existe)'}

Versões: ${versions}

Encontre a CAUSA COMUM e o que mudar para o erro parar de acontecer (configuração, padrão de import do projeto, regra de lint, versão de biblioteca). Não repita as correções pontuais.

Responda em português com:
## Causa comum
## Como evitar
(mudança concreta: arquivo e trecho)
## Se não houver causa comum
(diga isso em uma frase, se for o caso)`;
}

async function offerRecurringInvestigation(code: string): Promise<void> {
  const occurrences = await recentErrorOccurrences(code, RECURRING_DAYS);
  if (occurrences.count < RECURRING_THRESHOLD) return;

  const examples = occurrences.files.slice(-3).join(', ');
  console.log(`\n🔁 Este é o ${occurrences.count}º ${code} nos últimos ${RECURRING_DAYS} dias${examples ? ` (ex.: ${examples})` : ''}.`);

  const investigate = await confirm('Quer que eu investigue por que ele se repete (config, padrão do projeto)?');
  if (!investigate) return;

  const history = (await readNote('errors', code))?.body ?? '';
  const prompt = buildRecurringPrompt(code, history, readTsconfigText(), await describeVersions());
  const report = cleanAnswer(await askFor('architect', prompt, { timeoutMs: ARCHITECT_TIMEOUT_MS }));
  await showSuggestion(`🔎 Por que o ${code} se repete:`, report, `${code} recorrente (${occurrences.count}x em ${RECURRING_DAYS} dias)`, 'architect', code);
}

async function showSuggestion(title: string, suggestion: string, erro: string, task: AiTask, code: string | null): Promise<void> {
  console.log(`\n${title}`);
  console.log(suggestion);
  console.log('\nAplique a mudança acima manualmente no seu editor.');

  const useful = await confirm('A sugestão foi útil?');
  await recordFeedback('fixes', useful ? 'approved' : 'rejected', erro.trim().split('\n')[0]);
  await recordOutcome(task, useful ? 'approved' : 'rejected');

  // Only suggestions the developer found useful become knowledge (a wrong root cause would mislead later).
  if (useful) await noteInvestigation(code, erro, suggestion);
}

// ---------------------------------------------------------------------------
// Same-code expansion
// ---------------------------------------------------------------------------

function diagnosticKey(diagnostic: TscDiagnostic): string {
  return `${path.resolve(diagnostic.filePath)}:${diagnostic.lineIndex}:${diagnostic.code}`;
}

async function offerSameCodeFixes(code: string, attempted: Set<string>, session: FixBackup[]): Promise<void> {
  console.log('\n🔍 Rodando typecheck para procurar erros iguais...');
  const typecheck = runTypecheck();
  const sameCode = typecheck.diagnostics.filter(
    (diagnostic) => diagnostic.code === code && !attempted.has(diagnosticKey(diagnostic))
  );

  if (sameCode.length === 0) {
    console.log(
      typecheck.success
        ? '✅ O typecheck não encontrou mais erros.'
        : `Nenhum outro erro ${code}. Ainda há ${typecheck.errorCount} erro(s) de outros tipos.`
    );
    return;
  }

  const files = new Set(sameCode.map((diagnostic) => diagnostic.filePath));
  console.log(`\nEncontrei mais ${sameCode.length} erro(s) ${code} em ${files.size} arquivo(s):`);
  sameCode
    .slice(0, MAX_LISTED_DIAGNOSTICS)
    .forEach((diagnostic) => console.log(`  - ${diagnostic.filePath}:${diagnostic.lineIndex + 1}`));
  if (sameCode.length > MAX_LISTED_DIAGNOSTICS) console.log(`  … e mais ${sameCode.length - MAX_LISTED_DIAGNOSTICS}`);

  const expand = await confirm('Corrigir os outros também?');
  await recordFeedback(
    'fixes',
    expand ? 'approved' : 'rejected',
    `expansão ${code}: ${sameCode.length} erro(s) em ${files.size} arquivo(s)`
  );
  if (!expand) return;

  if (!(code in DETERMINISTIC_FIXES)) {
    console.log('\nSem regra determinística para este erro: usando o modelo local direto (sem clipboard).');
  }

  const fixedFiles: string[] = [];
  // Agent Board: without a deterministic rule each error is a job of the Revisor, "a fazer" until its turn.
  if (!(code in DETERMINISTIC_FIXES)) {
    queueJobs('fix', sameCode.map((diagnostic) => `${code} em ${diagnostic.filePath}:${diagnostic.lineIndex + 1}`));
  }
  try {
    for (let i = 0; i < sameCode.length; i += 1) {
      const diagnostic = sameCode[i];
      attempted.add(diagnosticKey(diagnostic));
      console.log(`\nCorrigindo ${i + 1}/${sameCode.length}: ${diagnostic.filePath}:${diagnostic.lineIndex + 1}`);

      const applied = await fixDiagnostic(diagnostic, session, 'batch');
      if (applied) fixedFiles.push(`${diagnostic.filePath}:${diagnostic.lineIndex + 1}`);
    }
  } finally {
    clearQueuedJobs('fix');
  }

  console.log(`\n✅ ${fixedFiles.length}/${sameCode.length} erro(s) ${code} corrigido(s).`);
  if (fixedFiles.length > 0) await noteBatchFix(code, fixedFiles.length, sameCode.length, fixedFiles);

  const after = runTypecheck();
  console.log(after.success ? '✅ O typecheck não encontrou mais erros.' : `Ainda há ${after.errorCount} erro(s) no typecheck.`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runFix(options: FixOptions = {}): Promise<void> {
  if (options.undo) {
    await undoLastFix();
    return;
  }

  await loadContext();
  const erro = await readErrorInput();
  if (!erro.trim()) return;

  const diagnostics = parseTscDiagnostics(erro);
  if (diagnostics.length === 0) {
    const suggestion = await askFor('fix', buildGenericFixPrompt(erro));
    await showSuggestion('💡 Sugestão de correção:', suggestion, erro, 'fix', null);
    return;
  }

  // Only the file of the pasted error is fixed automatically; everything else is offered afterwards.
  const target = diagnostics[0];
  const targetFile = path.resolve(target.filePath);
  const sameFile = diagnostics.filter((diagnostic) => path.resolve(diagnostic.filePath) === targetFile);
  const severity = classifyError(diagnostics, target);

  console.log(
    `\n📄 ${target.filePath}: ${sameFile.length} erro(s) colado(s) neste arquivo · ${severity === 'simple' ? '🟢 simples' : '🟠 complexo'}`
  );

  const session: FixBackup[] = [];
  const attempted = new Set<string>();
  const applied: AppliedFix[] = [];

  // Simple: line fix (rule → AI). Complex: only proven deterministic rules touch the file;
  // the rest goes to the root-cause investigation.
  for (const diagnostic of sameFile) {
    attempted.add(diagnosticKey(diagnostic));
    const result = await fixDiagnostic(diagnostic, session, severity === 'simple' ? 'interactive' : 'rules-only');
    if (result) applied.push(result);
  }

  if (applied.length === 0) {
    // No yes/no question: a failed line fix escalates to the investigation on its own.
    const report = await investigateComplexError(erro, target);
    await showSuggestion('🔎 Investigação:', report, erro, 'architect', target.code);
    return;
  }

  openDiffInEditor(applied[0].backupPath, applied[0].diagnostic.filePath);
  for (const fix of applied) {
    await noteFixedError({
      code: fix.diagnostic.code,
      message: fix.diagnostic.message,
      filePath: fix.diagnostic.filePath,
      line: fix.diagnostic.lineIndex + 1,
      before: fix.before,
      after: fix.after,
      source: fix.source,
    });
  }
  await recordFeedback('fixes', 'approved', `${target.code} ${target.filePath}:${target.lineIndex + 1} (aplicado)`);
  await recordOutcome('fix', 'approved');
  console.log(`\n✅ ${applied.length} correção(ões) aplicada(s) em ${target.filePath}.`);

  await offerSameCodeFixes(target.code, attempted, session);
  await offerRecurringInvestigation(target.code);

  console.log('\nPara desfazer tudo o que este kvasir fix alterou: kvasir fix --undo');
}
