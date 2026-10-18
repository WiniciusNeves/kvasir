import { getDiff, getDiffStat } from '@utils/git';
import { parseAddedLines } from '@utils/diff';
import type { AddedLine } from '@utils/diff';
import { askFor } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { noteUsefulReview } from '@modules/knowledge/auto';
import { answerLines } from '@ai/parse';
import { confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/ensure';
import { recordFeedback } from '@utils/feedback';
import type { KvasirContext } from '@ktypes/context';

const MAX_REVIEW_LINES = 150;
const TOKENS_PER_LINE = 40;
const NO_ISSUES = 'Nenhum problema encontrado.';
const TRIVIAL_LINE = /^\s*[{}()[\];,]*\s*$/;

interface ReviewLine extends AddedLine {
  id: string;
}

// Prompt technique (no fixed rules): the model must give a verdict for EVERY added line, with an
// example of the format. Asked for "a list of problems", qwen2.5-coder answered "no problems" for a
// diff with an off-by-one, a hardcoded key and an `any`; line by line it found all three.
function selectReviewLines(diff: string): ReviewLine[] {
  return parseAddedLines(diff)
    .filter((line) => !TRIVIAL_LINE.test(line.text))
    .slice(0, MAX_REVIEW_LINES)
    .map((line, index) => ({ ...line, id: `L${index + 1}` }));
}

function buildReviewPrompt(context: KvasirContext, lines: ReviewLine[]): string {
  const listing = lines.map((line) => `${line.id} ${line.filePath}:${line.lineNumber} | ${line.text}`).join('\n');

  return `Você é um revisor de código sênior em ${context.project.stack.join(', ') || 'TypeScript'}. Projeto: ${context.summary}

Abaixo estão as linhas ADICIONADAS num commit. Cada uma tem um identificador (L1, L2...), o arquivo e o número da linha.

${listing}

Analise cada linha, uma por uma. Para CADA identificador escreva exatamente uma linha de resposta:
<id>: OK
ou
<id>: PROBLEMA [bug|segurança|estilo] <o problema> — <como corrigir>

O que conta como problema:
- bug: limite de laço errado (ex.: "i <= arr.length" lê um índice que não existe), null/undefined não tratado, divisão por zero, await esquecido, condição invertida
- segurança: senha, token ou chave de API escritos no código; entrada do usuário sem validação
- estilo: tipo "any", função exportada sem tipo de retorno, console.log/debugger esquecido

Exemplo (outro código, só para mostrar o formato):
L1 src/x.ts:4 | export function parse(input: any) {
L2 src/x.ts:5 |   const n = Number(input);
L1: PROBLEMA [estilo] parâmetro "input" com tipo any e sem tipo de retorno — use "input: string" e ": number"
L2: OK

Responda só com as linhas no formato acima, uma para cada identificador, sem repetir o código.`;
}

// Maps "L3: PROBLEMA [bug] ..." back to "file:line". Anything that is not "OK" counts as a finding
// (the model sometimes writes "SECURITY" instead of "PROBLEMA").
function parseFindings(response: string, lines: ReviewLine[]): string[] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const findings = new Map<string, string>();

  for (const answer of answerLines(response)) {
    const match = answer.match(/^(L\d+)\s*:\s*(.+)$/i);
    if (!match) continue;

    const line = byId.get(match[1].toUpperCase());
    const verdict = match[2].trim();
    if (!line || /^ok\b/i.test(verdict) || findings.has(line.id)) continue;

    const description = verdict.replace(/^(problema|problem|security|seguran[cç]a)\s*/i, '');
    findings.set(line.id, `- ${line.filePath}:${line.lineNumber} ${description}`);
  }

  return [...findings.values()];
}

export async function runReview(): Promise<void> {
  const diff = getDiff();

  if (!diff.trim()) {
    console.log('Nenhuma mudança staged para revisar. Use "git add" antes.');
    return;
  }

  const context = await loadContext();
  const lines = selectReviewLines(diff);
  if (lines.length === 0) {
    console.log('Nenhuma linha de código adicionada para revisar.');
    return;
  }

  console.log(`\n${getDiffStat().trim()}`);
  if (parseAddedLines(diff).length > lines.length) {
    console.log(`(revisando ${lines.length} linhas; linhas vazias/só com chaves e o que passou de ${MAX_REVIEW_LINES} ficaram de fora)`);
  }

  const response = await askFor('review', buildReviewPrompt(context, lines), {
    temperature: 0.1,
    repeatPenalty: 1.1,
    maxTokens: Math.max(400, lines.length * TOKENS_PER_LINE),
  });
  const findings = parseFindings(response, lines);

  console.log('\n🔎 Revisão:');
  console.log(findings.length > 0 ? findings.join('\n') : NO_ISSUES);

  // The review only suggests; applying is up to the developer (see Doc/kvasir-current.md #3).
  const useful = await confirm('As sugestões foram úteis?');
  await recordFeedback('patterns', useful ? 'approved' : 'rejected', `review: ${findings[0] ?? NO_ISSUES}`);
  await recordOutcome('review', useful ? 'approved' : 'rejected');
  console.log('Feedback registrado.');
  if (useful && findings.length > 0) await noteUsefulReview(findings);
}
