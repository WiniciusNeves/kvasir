import { getDiff, getDiffStat } from '@utils/git';
import { parseAddedLines } from '@utils/diff';
import type { AddedLine } from '@utils/diff';
import { askFor } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { noteUsefulReview } from '@modules/knowledge/auto';
import { answerLines } from '@ai/parse';
import { projectExamples, recordExample } from '@ai/examples';
import type { ExampleDecision } from '@ai/examples';
import { askReason, checkbox, confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/ensure';
import { recordFeedback } from '@utils/feedback';
import { markDiffReviewed } from '@modules/proactive/suggestions';
import { relatedContext } from '@modules/omnicontext/context';
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

function buildReviewPrompt(context: KvasirContext, lines: ReviewLine[], projectContext = ''): string {
  const listing = lines.map((line) => `${line.id} ${line.filePath}:${line.lineNumber} | ${line.text}`).join('\n');

  return `Você é um revisor de código sênior em ${context.project.stack.join(', ') || 'TypeScript'}. Projeto: ${context.summary}

Abaixo estão as linhas ADICIONADAS num commit. Cada uma tem um identificador (L1, L2...), o arquivo e o número da linha.

${listing}
${projectContext ? `\n${projectContext}\nUse esses trechos só para conferir assinaturas, tipos e nomes usados nas linhas adicionadas.\n` : ''}
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

interface Finding {
  line: ReviewLine;
  description: string;
}

// Maps "L3: PROBLEMA [bug] ..." back to the line. Anything that is not "OK" counts as a finding
// (the model sometimes writes "SECURITY" instead of "PROBLEMA").
function parseFindings(response: string, lines: ReviewLine[]): Finding[] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const findings = new Map<string, Finding>();

  for (const answer of answerLines(response)) {
    const match = answer.match(/^(L\d+)\s*:\s*(.+)$/i);
    if (!match) continue;

    const line = byId.get(match[1].toUpperCase());
    const verdict = match[2].trim();
    if (!line || /^ok\b/i.test(verdict) || findings.has(line.id)) continue;

    findings.set(line.id, { line, description: verdict.replace(/^(problema|problem|security|seguran[cç]a)\s*/i, '') });
  }

  return [...findings.values()];
}

function formatFinding(finding: Finding): string {
  return `- ${finding.line.filePath}:${finding.line.lineNumber} ${finding.description}`;
}

// The case of a review example is the code line itself, with its file (line numbers move, the text stays).
function exampleInput(line: ReviewLine): string {
  return `${line.filePath} | ${line.text.trim()}`;
}

// "[bug] x — y" → "bug": the same kind of warning, whatever words the model picked this time.
function findingKind(description: string): string {
  const match = description.match(/\[\s*([^\]]+?)\s*\]/);
  return (match?.[1] ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function findingKey(input: string, description: string): string {
  return `${input}\u0000${findingKind(description)}`;
}

// A fact from the developer's own verdicts, not a rule about the model: a warning of the same kind on the
// same line of the same file that they ignored last time is hidden now. A later "useful" brings it back.
async function splitIgnored(findings: Finding[]): Promise<{ shown: Finding[]; hidden: Finding[] }> {
  const lastVerdict = new Map<string, ExampleDecision>();
  for (const example of await projectExamples('review')) {
    lastVerdict.set(findingKey(example.input, example.output), example.decision);
  }
  const hidden = findings.filter((finding) => lastVerdict.get(findingKey(exampleInput(finding.line), finding.description)) === 'rejected');
  return { shown: findings.filter((finding) => !hidden.includes(finding)), hidden };
}

// One verdict per finding, recorded as examples. They do NOT go back into the prompt: tested on a real
// project, qwen2.5-coder copied whatever warnings it was shown. The useful ones made the review shrink
// (4 → 2 warnings, the hardcoded token dropped); an ignored one came back in every round (Doc/kvasir-decisions.md).
async function judgeFindings(findings: Finding[]): Promise<{ useful: Finding[]; ignoredReason: string }> {
  const usefulIds = await checkbox<string>(
    'Quais avisos foram úteis? (espaço marca, Enter confirma; os não marcados contam como ignorados)',
    findings.map((finding) => ({ name: formatFinding(finding).slice(2), value: finding.line.id }))
  );
  const useful = findings.filter((finding) => usefulIds.includes(finding.line.id));
  // one optional "why" for the ignored ones as a group: asking per warning would cost more than it teaches
  const ignoredReason = useful.length < findings.length ? await askReason('Por que ignorou os outros? (opcional, Enter pula)') : '';
  for (const finding of findings) {
    const approved = useful.includes(finding);
    await recordExample('review', {
      input: exampleInput(finding.line),
      output: finding.description,
      decision: approved ? 'approved' : 'rejected',
      reason: approved ? undefined : ignoredReason,
    });
  }
  return { useful, ignoredReason };
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

  const changedFiles = [...new Set(lines.map((line) => line.filePath))];
  const projectContext = await relatedContext(lines.map((line) => line.text.trim()).join('\n').slice(0, 1500), { excludeFiles: changedFiles });
  const response = await askFor('review', buildReviewPrompt(context, lines, projectContext), {
    temperature: 0.1,
    repeatPenalty: 1.1,
    maxTokens: Math.max(400, lines.length * TOKENS_PER_LINE),
  });
  const { shown: findings, hidden } = await splitIgnored(parseFindings(response, lines));

  console.log('\n🔎 Revisão:');
  console.log(findings.length > 0 ? findings.map(formatFinding).join('\n') : hidden.length > 0 ? 'Nenhum aviso novo.' : NO_ISSUES);
  if (hidden.length > 0) {
    console.log(`\n🙈 ${hidden.length} aviso(s) escondido(s): você ignorou o mesmo tipo de aviso nessas linhas antes.`);
    console.log(hidden.map(formatFinding).join('\n'));
  }

  // The review only suggests; applying is up to the developer (see Doc/kvasir-current.md #3).
  if (findings.length === 0 && hidden.length > 0) {
    // only warnings already judged: nothing new to ask, and no verdict on the model from a repeat
    console.log('Nada novo para avaliar.');
  } else if (findings.length === 0) {
    const agreed = await confirm('Concorda que não há problemas nessas linhas?');
    const reason = agreed ? '' : await askReason('O que ficou de fora? (opcional, Enter pula)');
    await recordFeedback('patterns', agreed ? 'approved' : 'rejected', `review: ${NO_ISSUES}`, reason);
    await recordOutcome('review', agreed ? 'approved' : 'rejected');
  } else {
    const { useful, ignoredReason } = await judgeFindings(findings);
    // the review as a whole is good when most of its warnings were worth reading
    const verdict = useful.length * 2 >= findings.length ? 'approved' : 'rejected';
    const ignored = findings.find((finding) => !useful.includes(finding));
    const reason = ignored && ignoredReason ? `ignorou "${formatFinding(ignored).slice(2)}"${useful.length + 1 < findings.length ? ' e outros' : ''}: ${ignoredReason}` : '';
    await recordFeedback('patterns', verdict, `review: ${useful.length}/${findings.length} avisos úteis; ${formatFinding(useful[0] ?? findings[0])}`, reason);
    await recordOutcome('review', verdict);
    console.log(`${useful.length} de ${findings.length} aviso(s) úteis.`);
    if (useful.length > 0) await noteUsefulReview(useful.map(formatFinding));
  }
  console.log('Feedback registrado.');
  await markDiffReviewed(diff);
}
