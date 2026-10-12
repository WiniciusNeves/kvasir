import { askFor } from '@ai/router';
import { input, confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';
import { readFile, writeFile, pathExists, copyFile, removeFile } from '@utils/fs';
import { runTypecheck } from '@utils/typecheck';
import { openDiffInEditor } from '@utils/editor';

const FILE_PATH_REGEX = /^([^\s:]+\.(ts|tsx))/;
const LINE_NUMBER_REGEX = /:(\d+):\d+/;
const ALL_FILES_REGEX = /[^\s:]+\.(ts|tsx|js|jsx|json)/g;

const SIMPLE_TS_CODES = new Set(['TS6137', 'TS2345', 'TS2551']);
const CONFIG_FILE_NAMES = ['tsconfig.json', 'babel.config.js', 'babel.config.ts', 'next.config.js', 'next.config.ts'];

const MAX_INVESTIGATION_ROUNDS = 3;
const MAX_RESOLUTION_ATTEMPTS = 3;

type ErrorSeverity = 'simple' | 'complex';
type FixAttemptResult = 'applied' | 'skipped' | 'file-not-found';

interface FileContext {
  filePath: string;
  content: string;
  lineNumber: number | null;
}

type FileLookup =
  | { status: 'none' }
  | { status: 'not-found'; filePath: string }
  | { status: 'found'; context: FileContext };

function extractErrorSection(output: string): string {
  const lines = output.split('\n');
  const startIndex = lines.findIndex((line) => FILE_PATH_REGEX.test(line));
  return startIndex === -1 ? output.trim() : lines.slice(startIndex).join('\n').trim();
}

function classifyError(erro: string): ErrorSeverity {
  const tsCodes = erro.match(/TS\d+/g) ?? [];
  const filePaths = erro.match(ALL_FILES_REGEX) ?? [];
  const uniqueFiles = new Set(filePaths);

  const hasConfigError = filePaths.some((file) => CONFIG_FILE_NAMES.some((configFile) => file.endsWith(configFile)));
  if (hasConfigError) return 'complex';
  if (uniqueFiles.size > 1) return 'complex';
  if (tsCodes.length > 5) return 'complex';

  const isKnownSimpleCode = tsCodes.length > 0 && tsCodes.every((code) => SIMPLE_TS_CODES.has(code));
  const isLintError = tsCodes.length === 0 && /eslint|prettier/i.test(erro);
  if (isKnownSimpleCode || isLintError) return 'simple';

  return 'complex';
}

async function resolveFileContext(erro: string): Promise<FileLookup> {
  const fileMatch = erro.match(FILE_PATH_REGEX);
  if (!fileMatch) return { status: 'none' };

  const filePath = fileMatch[1];
  const exists = await pathExists(filePath);
  if (!exists) return { status: 'not-found', filePath };

  const content = await readFile(filePath);
  if (content === null) return { status: 'not-found', filePath };

  const lineMatch = erro.match(LINE_NUMBER_REGEX);
  const lineNumber = lineMatch ? parseInt(lineMatch[1], 10) - 1 : null;

  return { status: 'found', context: { filePath, content, lineNumber } };
}

function getValidLineNumber(fileContext: FileContext): number | null {
  if (fileContext.lineNumber === null) return null;

  const totalLines = fileContext.content.split('\n').length;
  if (fileContext.lineNumber < 0 || fileContext.lineNumber >= totalLines) return null;

  return fileContext.lineNumber;
}

function buildFileFixPrompt(erro: string, fileContext: FileContext): string {
  return `Você é um especialista em TypeScript.
Analise o erro e o arquivo abaixo e corrija APENAS a linha com problema.

REGRAS:
- Não invente caminhos de arquivo
- Use apenas imports que existem no arquivo atual
- Se o erro indicar que um import usa um prefixo incorreto (ex: "@types/X" quando o correto é apenas "X"), remova o prefixo inválido do caminho de import
- Se o erro for TS6137 (Cannot import type declaration files):
  - Mantenha o mesmo caminho de import
  - Apenas remova a palavra 'type' do import
  - Exemplo: 'import type { X } from Y' → 'import { X } from Y'
- Responda APENAS com a linha corrigida, sem explicações

Erro:
${erro}

Arquivo ${fileContext.filePath}:
${fileContext.content}

Linha com erro e como deve ficar depois da correção:`;
}

function buildGenericFixPrompt(erro: string): string {
  return `Você é um especialista em TypeScript e React Native.
Analise o erro abaixo e sugira a correção.

Responda em português com:
## Causa
(explique o problema em 1-2 frases)

## Solução
(explique como corrigir)

## Código corrigido
(mostre apenas o trecho corrigido, sem o arquivo inteiro)

Erro:
${erro}`;
}

function buildInvestigationPrompt(context: string): string {
  return `Você é um especialista sênior em TypeScript e React Native investigando um erro complexo.

Este erro pode envolver múltiplos arquivos, erro em cascata, configuração do projeto (tsconfig, babel, etc.) ou uma causa que você ainda não reconhece.

Se precisar de mais informação do usuário antes de propor a correção, responda APENAS com uma linha no formato:
PERGUNTA: <sua pergunta objetiva>

Caso já tenha informação suficiente, responda em português com:
## Causa raiz
(explique a causa raiz, não apenas o sintoma)

## Arquivos afetados
(liste os arquivos envolvidos na correção)

## Correção proposta
(descreva a correção completa, arquivo por arquivo, sem inventar caminhos que não existem)

Erro e contexto da investigação até agora:
${context}`;
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

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^```\w*\n?/, '')
    .replace(/```$/, '')
    .trim();
}

function parseCorrectedLine(response: string): string {
  const lines = response.split('\n').map(cleanMarkdownLine);
  const nonEmptyLine = lines.find((line) => line.length > 0);
  if (nonEmptyLine) return nonEmptyLine;

  const backtickMatch = response.match(/`([^`]+)`/);
  return backtickMatch ? backtickMatch[1] : response.trim();
}

const DETERMINISTIC_FIXES: Record<string, (oldLine: string) => string> = {
  TS6137: (oldLine) => oldLine.replace('import type {', 'import {'),
};

function getDeterministicCorrection(erro: string, oldLine: string): string | null {
  const tsCodes = erro.match(/TS\d+/g) ?? [];

  for (const code of tsCodes) {
    const fix = DETERMINISTIC_FIXES[code];
    if (fix) return fix(oldLine);
  }

  return null;
}

function showLineDiff(oldLine: string, newLine: string): void {
  console.log('\n📋 Diferença:');
  console.log('─'.repeat(60));
  console.log(`ANTES: ${oldLine.trim()}`);
  console.log(`DEPOIS: ${newLine.trim()}`);
  console.log('─'.repeat(60));
}

async function promptAndApplyLineFix(
  erro: string,
  fileContext: FileContext,
  lineNumber: number,
  correctedLine: string
): Promise<FixAttemptResult> {
  const lines = fileContext.content.split('\n');
  const oldLine = lines[lineNumber];

  showLineDiff(oldLine, correctedLine);

  const tempFile = `${fileContext.filePath}.kvasir-original`;
  await copyFile(fileContext.filePath, tempFile);

  lines[lineNumber] = correctedLine;
  await writeFile(fileContext.filePath, lines.join('\n'));

  openDiffInEditor(tempFile, fileContext.filePath);

  const approved = await confirm('Aplicar esta correção?');
  await recordFeedback('fixes', approved ? 'approved' : 'rejected', erro.trim());

  if (!approved) {
    await copyFile(tempFile, fileContext.filePath);
    await removeFile(tempFile);
    console.log('Correção descartada. Arquivo original restaurado.');
    return 'skipped';
  }

  await removeFile(tempFile);
  console.log(`\n✅ Correção aplicada em ${fileContext.filePath} linha ${lineNumber + 1}`);

  return 'applied';
}

async function runSingleFixAttempt(rawError: string): Promise<FixAttemptResult> {
  const erro = extractErrorSection(rawError);
  const severity = classifyError(erro);
  const lookup = await resolveFileContext(erro);

  if (lookup.status === 'not-found') {
    console.log(`\n❌ Arquivo não encontrado: ${lookup.filePath}`);
    console.log('Verifique se está na pasta raiz do projeto.');
    return 'file-not-found';
  }

  const fileContext = lookup.status === 'found' ? lookup.context : null;

  if (fileContext) {
    console.log(`\n📄 Arquivo detectado: ${fileContext.filePath} (conteúdo incluído no contexto)`);
  }

  const validLine = fileContext ? getValidLineNumber(fileContext) : null;

  if (fileContext && validLine !== null) {
    const oldLine = fileContext.content.split('\n')[validLine];
    const deterministicLine = getDeterministicCorrection(erro, oldLine);

    if (deterministicLine !== null) {
      console.log('\n🟢 Erro com correção determinística conhecida — aplicando sem chamar a IA.');
      console.log('\nCorreção sugerida:');
      console.log(deterministicLine);
      return promptAndApplyLineFix(erro, fileContext, validLine, deterministicLine);
    }
  }

  console.log(
    severity === 'simple'
      ? '\n🟢 Erro classificado como simples — corrigindo diretamente.'
      : '\n🟠 Erro classificado como complexo — investigando com deepseek-r1...'
  );

  const suggestion =
    severity === 'complex'
      ? await investigateComplexError(erro)
      : await askFor('fix', fileContext ? buildFileFixPrompt(erro, fileContext) : buildGenericFixPrompt(erro));

  console.log('\nCorreção sugerida:');
  console.log(suggestion);

  if (fileContext && validLine !== null) {
    return promptAndApplyLineFix(erro, fileContext, validLine, parseCorrectedLine(suggestion));
  }

  const approved = await confirm('Aplicar esta correção?');
  await recordFeedback('fixes', approved ? 'approved' : 'rejected', erro.trim());

  if (!approved) {
    console.log('Correção descartada.');
  } else {
    console.log('\nAplique a mudança acima manualmente ou cole no seu editor.');
  }

  return 'skipped';
}

async function resolveError(initialError: string): Promise<void> {
  let currentError = initialError;

  for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt += 1) {
    const result = await runSingleFixAttempt(currentError);
    if (result !== 'applied') return;

    console.log('\n🔍 Rodando typecheck para confirmar a correção...');
    const typecheck = runTypecheck();

    if (typecheck.success) {
      console.log('\n✅ Resolvido. O typecheck não encontrou mais erros.');
      return;
    }

    console.log(`\n⚠️ Ainda há ${typecheck.errorCount} erro(s) após a correção.`);
    const investigateMore = await confirm('Investigar os erros restantes?');

    if (!investigateMore) {
      console.log('\nEncerrando. Rode "kvasir fix" novamente quando quiser investigar o restante.');
      return;
    }

    currentError = typecheck.output;
  }

  console.log('\n⚠️ Limite de tentativas atingido. Revise manualmente os erros restantes.');
}

export async function runFix(): Promise<void> {
  await loadContext();
  const error = await input('Cole o erro que deseja corrigir:');

  await resolveError(error);
}
