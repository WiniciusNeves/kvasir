import os from 'os';
import path from 'path';
import { askFor, askLocal } from '@ai/router';
import { readClipboard } from '@ai/client';
import { stripThinking } from '@ai/ollama';
import { input, confirm, select } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';
import { readFile, writeFile, readJson, copyFile, removeFile } from '@utils/fs';
import { runTypecheck, parseTscDiagnostics } from '@utils/typecheck';
import type { TscDiagnostic } from '@utils/typecheck';
import { openDiffInEditor } from '@utils/editor';

const MAX_INVESTIGATION_ROUNDS = 3;
const CONTEXT_RADIUS = 15;
const MAX_LISTED_DIAGNOSTICS = 10;
const LINE_FIX_MAX_TOKENS = 256;

type ErrorSource = 'clipboard' | 'typecheck' | 'type';
type FixMode = 'interactive' | 'batch';

export interface FixOptions {
  undo?: boolean;
}

interface FixBackup {
  filePath: string;
  backupPath: string;
}

interface AppliedFix {
  filePath: string;
  backupPath: string;
  lineIndex: number;
}

interface SplitFile {
  lines: string[];
  eol: string;
}

// ---------------------------------------------------------------------------
// Backups and undo (~/.kvasir/backups/fix)
// ---------------------------------------------------------------------------

function getBackupDir(): string {
  return path.join(os.homedir(), '.kvasir', 'backups', 'fix');
}

function getManifestPath(): string {
  return path.join(getBackupDir(), 'last-fix.json');
}

// One backup per file per run, taken before the first change; the manifest of the last run powers `--undo`.
async function ensureBackup(session: FixBackup[], filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  const existing = session.find((backup) => backup.filePath === absolutePath);
  if (existing) return existing.backupPath;

  const extension = path.extname(absolutePath);
  const baseName = path.basename(absolutePath, extension);
  const backupPath = path.join(getBackupDir(), `${Date.now()}-${baseName}.kvasir-original${extension}`);

  await copyFile(absolutePath, backupPath);
  session.push({ filePath: absolutePath, backupPath });
  await writeFile(getManifestPath(), JSON.stringify(session, null, 2));

  return backupPath;
}

async function undoLastFix(): Promise<void> {
  const manifest = await readJson<FixBackup[]>(getManifestPath());
  if (!manifest || manifest.length === 0) {
    console.log('Nenhuma correção do kvasir fix para desfazer.');
    return;
  }

  console.log('\nArquivos alterados pelo último kvasir fix:');
  manifest.forEach((backup) => console.log(`  - ${path.relative(process.cwd(), backup.filePath)}`));

  const approved = await confirm(`Restaurar ${manifest.length} arquivo(s) para a versão anterior?`);
  if (!approved) {
    console.log('Nada foi restaurado.');
    return;
  }

  for (const backup of manifest) {
    await copyFile(backup.backupPath, backup.filePath);
    await removeFile(backup.backupPath);
  }
  await removeFile(getManifestPath());
  await recordFeedback('fixes', 'rejected', `undo: ${manifest.length} arquivo(s) restaurado(s)`);

  console.log(`✅ ${manifest.length} arquivo(s) restaurado(s).`);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Multi-line errors can't go through `input()` (single-line: the rest leaked into the next prompts),
// so the default is to read what the user copied.
async function readErrorInput(): Promise<string> {
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

  const preview = text.split('\n').slice(0, 3).join('\n');
  console.log(`\n📋 Erro lido do clipboard:\n${preview}${text.split('\n').length > 3 ? '\n…' : ''}`);
  return text;
}

// ---------------------------------------------------------------------------
// Line fixes: deterministic rules first, AI second
// ---------------------------------------------------------------------------

function splitFile(content: string): SplitFile {
  return { lines: content.split(/\r?\n/), eol: content.includes('\r\n') ? '\r\n' : '\n' };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceModuleSpecifier(line: string, from: string, to: string): string {
  return line.replace(new RegExp(`(['"])${escapeRegex(from)}\\1`), `$1${to}$1`);
}

// Each rule returns the fixed line, or the same line when it doesn't apply.
const DETERMINISTIC_FIXES: Record<string, (line: string, diagnostic: TscDiagnostic) => string> = {
  // "Cannot import type declaration files. Consider importing 'X' instead of '@types/X'."
  TS6137: (line, diagnostic) => {
    const match = diagnostic.message.match(/importing '([^']+)' instead of '([^']+)'/);
    if (match) return replaceModuleSpecifier(line, match[2], match[1]);
    return line.replace(/(['"])@types\/([^'"]+)\1/, '$1$2');
  },
};

function applyDeterministicFix(line: string, diagnostic: TscDiagnostic): string | null {
  const rule = DETERMINISTIC_FIXES[diagnostic.code];
  if (!rule) return null;

  const fixed = rule(line, diagnostic);
  return fixed !== line ? fixed : null;
}

function buildNumberedSnippet(lines: string[], lineIndex: number): string {
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

function buildLineFixPrompt(diagnostic: TscDiagnostic, lines: string[]): string {
  const lineNumber = diagnostic.lineIndex + 1;

  return `Você corrige UMA linha de um arquivo TypeScript a partir de um erro do compilador.

Erro do tsc:
${diagnostic.code}: ${diagnostic.message}

Arquivo: ${diagnostic.filePath} (linha ${lineNumber}, coluna ${diagnostic.column})

Trecho do arquivo (a linha com erro está marcada com >>):
${buildNumberedSnippet(lines, diagnostic.lineIndex)}

Linha ${lineNumber} atual:
${lines[diagnostic.lineIndex]}

REGRAS:
- Responda SOMENTE com a linha ${lineNumber} já corrigida, dentro de um bloco \`\`\`ts
- Uma única linha. Não repita a linha atual, não explique, não mexa em outras linhas
- Use apenas nomes, imports e caminhos que aparecem no trecho ou na mensagem de erro
- Se o erro sugerir um nome ou caminho ("Did you mean", "Consider importing"), use exatamente o sugerido

Resposta (só o bloco \`\`\`ts com a linha ${lineNumber} corrigida):`;
}

const PROSE_PREFIX = /^\s*(#|\*\*|linha|corre[cç][aã]o|explica|aqui|here|the |a linha)/i;
const LABEL_PREFIX = /^\s*(depois|corrigid[ao]|linha corrigida|after|fixed)\s*:\s*/i;
const SNIPPET_PREFIX = /^\s*>?>?\s*\d+\s*\|\s?/;
const LOOKS_LIKE_CODE = /[;{}()=<>[\]'"`]|^\s*(import|export|const|let|var|return|function|type|interface|class)\b/;

// Models answer with a code fence, an echoed snippet, labels or prose: keep the first real code line
// that differs from the original, with the original indentation.
function parseCorrectedLine(response: string, oldLine: string): string | null {
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

async function askLineFix(diagnostic: TscDiagnostic, lines: string[], mode: FixMode): Promise<string | null> {
  const prompt = buildLineFixPrompt(diagnostic, lines);
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
  const newLine = deterministic ?? (await askLineFix(diagnostic, lines, mode));
  if (newLine === null || newLine === oldLine) return null;

  const backupPath = await ensureBackup(session, diagnostic.filePath);
  lines[diagnostic.lineIndex] = newLine;
  await writeFile(diagnostic.filePath, lines.join(eol));

  showLineDiff(diagnostic, oldLine, newLine, deterministic ? 'regra determinística' : 'IA');
  return { filePath: diagnostic.filePath, backupPath, lineIndex: diagnostic.lineIndex };
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

function buildInvestigationPrompt(context: string): string {
  return `Você é um especialista sênior em TypeScript e React Native investigando um erro que não se resolve trocando uma linha.

Pode envolver vários arquivos, erro em cascata ou configuração (tsconfig, babel, etc.).

Erro e contexto da investigação até agora:
${context}

Se precisar de mais informação antes de propor a correção, responda APENAS com uma linha:
PERGUNTA: <sua pergunta objetiva>

Senão, responda em português com:
## Causa raiz
(a causa, não o sintoma)

## Arquivos afetados
(só arquivos que aparecem no erro ou no contexto)

## Correção proposta
(arquivo por arquivo, sem inventar caminhos)`;
}

function extractQuestion(response: string): string | null {
  const match = response.match(/^PERGUNTA:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

async function investigateComplexError(erro: string): Promise<string> {
  let context = erro;

  for (let round = 0; round < MAX_INVESTIGATION_ROUNDS; round += 1) {
    const response = await askFor('architect', buildInvestigationPrompt(context));
    const question = extractQuestion(response);
    if (!question) return response;

    console.log('\n🔎 Kvasir precisa de mais informação para investigar:');
    const answer = await input(question);
    context = `${context}\n\nPergunta: ${question}\nResposta do usuário: ${answer}`;
  }

  return askFor('architect', buildInvestigationPrompt(context));
}

async function showSuggestion(title: string, suggestion: string, erro: string): Promise<void> {
  console.log(`\n${title}`);
  console.log(suggestion);
  console.log('\nAplique a mudança acima manualmente no seu editor.');

  const useful = await confirm('A sugestão foi útil?');
  await recordFeedback('fixes', useful ? 'approved' : 'rejected', erro.trim().split('\n')[0]);
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

  let fixedCount = 0;
  for (let i = 0; i < sameCode.length; i += 1) {
    const diagnostic = sameCode[i];
    attempted.add(diagnosticKey(diagnostic));
    console.log(`\nCorrigindo ${i + 1}/${sameCode.length}: ${diagnostic.filePath}:${diagnostic.lineIndex + 1}`);

    const applied = await fixDiagnostic(diagnostic, session, 'batch');
    if (applied) fixedCount += 1;
  }

  console.log(`\n✅ ${fixedCount}/${sameCode.length} erro(s) ${code} corrigido(s).`);

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
    await showSuggestion('💡 Sugestão de correção:', suggestion, erro);
    return;
  }

  // Only the file of the pasted error is fixed automatically; everything else is offered afterwards.
  const target = diagnostics[0];
  const targetFile = path.resolve(target.filePath);
  const sameFile = diagnostics.filter((diagnostic) => path.resolve(diagnostic.filePath) === targetFile);

  console.log(`\n📄 Corrigindo ${target.filePath} (${sameFile.length} erro(s) colado(s) neste arquivo)`);

  const session: FixBackup[] = [];
  const attempted = new Set<string>();
  const applied: AppliedFix[] = [];

  for (const diagnostic of sameFile) {
    attempted.add(diagnosticKey(diagnostic));
    const result = await fixDiagnostic(diagnostic, session, 'interactive');
    if (result) applied.push(result);
  }

  if (applied.length === 0) {
    const investigate = await confirm('Não consegui corrigir trocando uma linha. Investigar o erro com o modelo de arquitetura?');
    if (investigate) {
      const report = await investigateComplexError(erro);
      await showSuggestion('🔎 Investigação:', report, erro);
    }
    return;
  }

  openDiffInEditor(applied[0].backupPath, applied[0].filePath);
  await recordFeedback('fixes', 'approved', `${target.code} ${target.filePath}:${target.lineIndex + 1} (aplicado)`);
  console.log(`\n✅ ${applied.length} correção(ões) aplicada(s) em ${target.filePath}.`);

  await offerSameCodeFixes(target.code, attempted, session);

  console.log('\nPara desfazer tudo o que este kvasir fix alterou: kvasir fix --undo');
}
