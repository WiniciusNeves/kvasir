import { getDiff, getStagedFiles, unstageFiles } from '@utils/git';
import { parseAddedLines } from '@utils/diff';
import { askLocal } from '@ai/router';
import { answerLines } from '@ai/parse';
import { recordOutcome } from '@ai/metrics';
import { confirm, select } from '@utils/prompt';
import { recordFeedback } from '@utils/feedback';
import { checkAddedLines, checkStagedFiles, findHighEntropyStrings, mask } from './rules';
import type { EntropyCandidate } from './rules';
import { loadAllowlist, applyAllowlist, isPathAllowed, isValueAllowed, addToAllowlist, ALLOWLIST_FILE } from './allowlist';
import type { GuardFinding } from '@ktypes/guard';

type BlockAction = 'cancel' | 'unstage' | 'ignore';
const MAX_AI_CANDIDATES = 20;

export interface GuardScan {
  findings: GuardFinding[];
  aiChecked: number;
}

function buildEntropyPrompt(candidates: EntropyCandidate[]): string {
  const listing = candidates
    .map((candidate, index) => `S${index + 1} ${candidate.filePath}:${candidate.lineNumber} | ${candidate.line.slice(0, 160)}`)
    .join('\n');

  return `Você é um especialista em segurança revisando um commit. As linhas abaixo têm strings longas e aleatórias.

${listing}

Para CADA identificador, diga se a string parece um SEGREDO REAL (chave de API, token, senha, credencial) ou algo inofensivo (hash de versão, id público, UUID, conteúdo base64 de imagem, dado de teste, classe CSS).
Responda uma linha por identificador, exatamente assim:
S1: SEGREDO <motivo curto>
ou
S1: OK <motivo curto>`;
}

// The only AI step: strings no deterministic rule recognised. Ollama offline → kept as warnings.
async function classifyHighEntropy(candidates: EntropyCandidate[]): Promise<GuardFinding[]> {
  const subset = candidates.slice(0, MAX_AI_CANDIDATES);
  const toFinding = (candidate: EntropyCandidate, severity: 'block' | 'warn', description: string): GuardFinding => ({
    ruleId: 'high-entropy',
    severity,
    filePath: candidate.filePath,
    lineNumber: candidate.lineNumber,
    description,
    excerpt: mask(candidate.value),
    match: candidate.value,
  });

  let response: string;
  try {
    console.log(`🤖 Pedindo à IA para avaliar ${subset.length} string(s) suspeita(s)...`);
    response = await askLocal('guard', buildEntropyPrompt(subset), { temperature: 0, maxTokens: 60 * subset.length });
  } catch {
    return subset.map((candidate) => toFinding(candidate, 'warn', 'string aleatória longa (IA indisponível para avaliar)'));
  }

  const findings: GuardFinding[] = [];
  for (const answer of answerLines(response)) {
    const match = answer.match(/^S(\d+)\s*:\s*(SEGREDO|SECRET)\b\s*(.*)$/i);
    const candidate = match ? subset[Number(match[1]) - 1] : undefined;
    if (candidate) findings.push(toFinding(candidate, 'block', `provável segredo segundo a IA${match?.[3] ? ` (${match[3].trim()})` : ''}`));
  }
  return findings;
}

export async function scanStagedChanges(): Promise<GuardScan> {
  const allowlist = await loadAllowlist();
  const files = getStagedFiles().filter((file) => !isPathAllowed(file, allowlist));
  const lines = parseAddedLines(getDiff()).filter((line) => !isPathAllowed(line.filePath, allowlist));

  const deterministic = applyAllowlist([...checkStagedFiles(files), ...checkAddedLines(lines)], allowlist);
  const candidates = findHighEntropyStrings(lines, deterministic).filter(
    (candidate) => !isValueAllowed(candidate.value, allowlist) && !allowlist.rules.has('high-entropy')
  );
  const fromAi = candidates.length > 0 ? await classifyHighEntropy(candidates) : [];

  return { findings: [...deterministic, ...fromAi], aiChecked: Math.min(candidates.length, MAX_AI_CANDIDATES) };
}

function printReport(findings: GuardFinding[]): void {
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1));
  console.log('\n🛡️  kvasir guard:');
  for (const finding of sorted) {
    const icon = finding.severity === 'block' ? '🔴' : '🟡';
    const where = finding.lineNumber === null ? finding.filePath : `${finding.filePath}:${finding.lineNumber}`;
    console.log(`  ${icon} ${where} — ${finding.description} — ${finding.excerpt}`);
  }
}

async function offerAllowlist(findings: GuardFinding[]): Promise<void> {
  const add = await confirm(`Adicionar ao ${ALLOWLIST_FILE} para não avisar de novo sobre estes itens?`);
  if (add) {
    await addToAllowlist(findings);
    console.log(`✅ ${findings.length} item(ns) adicionado(s) ao ${ALLOWLIST_FILE}.`);
  }
}

// Returns true when the commit may go ahead.
export async function guardStagedChanges(): Promise<boolean> {
  const { findings, aiChecked } = await scanStagedChanges();

  if (findings.length === 0) {
    console.log(`🛡️  kvasir guard: nenhum segredo ou dado sensível encontrado${aiChecked > 0 ? ` (${aiChecked} string(s) avaliada(s) pela IA)` : ''}.`);
    return true;
  }

  printReport(findings);
  const blocking = findings.filter((finding) => finding.severity === 'block');

  if (blocking.length === 0) {
    const proceed = await confirm('Só avisos (🟡). Continuar com o commit?');
    if (proceed) await offerAllowlist(findings);
    return proceed;
  }

  const files = Array.from(new Set(blocking.map((finding) => finding.filePath)));
  const action = await select<BlockAction>(`${blocking.length} problema(s) bloqueante(s). O que fazer?`, [
    { name: 'Cancelar o commit e corrigir', value: 'cancel' },
    { name: `Tirar do stage: ${files.join(', ')}`, value: 'unstage' },
    { name: 'Ignorar e commitar assim mesmo', value: 'ignore' },
  ]);

  // The AI's verdict was right when the developer acts on it.
  if (action !== 'ignore' && blocking.some((finding) => finding.ruleId === 'high-entropy')) await recordOutcome('guard', 'approved');

  if (action === 'cancel') {
    console.log('Commit cancelado. Remova os segredos (use variáveis de ambiente) e tente de novo.');
    return false;
  }

  if (action === 'unstage') {
    unstageFiles(files);
    console.log(`✅ Fora do stage: ${files.join(', ')} (os arquivos continuam no disco).`);
    return true;
  }

  // Ignoring a blocker needs a second, explicit confirmation.
  const sure = await confirm('Tem certeza? Segredos commitados ficam no histórico do git mesmo se apagados depois.');
  if (!sure) {
    console.log('Commit cancelado.');
    return false;
  }

  await recordFeedback('guard', 'rejected', blocking.map((finding) => `${finding.ruleId} ${finding.filePath}`).join('; '));
  if (blocking.some((finding) => finding.ruleId === 'high-entropy')) await recordOutcome('guard', 'rejected');
  await offerAllowlist(findings);
  return true;
}

export async function runGuard(): Promise<void> {
  if (getStagedFiles().length === 0) {
    console.log('Nada no stage para verificar. Use "git add" antes.');
    return;
  }

  const { findings, aiChecked } = await scanStagedChanges();
  if (findings.length === 0) {
    console.log(`🛡️  Nenhum segredo ou dado sensível no stage${aiChecked > 0 ? ` (${aiChecked} string(s) avaliada(s) pela IA)` : ''}.`);
    return;
  }

  printReport(findings);
  const blocking = findings.filter((finding) => finding.severity === 'block').length;
  console.log(`\n${blocking} bloqueante(s), ${findings.length - blocking} aviso(s). O "kvasir commit" vai parar nos bloqueantes.`);
}
