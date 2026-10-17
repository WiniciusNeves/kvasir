import { getDiff, getDiffStat } from '@utils/git';
import { askFor } from '@ai/router';
import { answerLines, truncateForPrompt } from '@ai/parse';
import { confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';
import { runReviewChecks } from './checks';
import type { KvasirContext } from '@ktypes/context';

const MAX_DIFF_CHARS = 12_000;
const MAX_AI_FINDINGS = 10;
const REVIEW_MAX_TOKENS = 700;
const NO_ISSUES = 'Nenhum problema encontrado.';

function buildReviewPrompt(context: KvasirContext, diff: string, stat: string, alreadyFound: string[]): string {
  return `Você é um revisor de código sênior em ${context.project.stack.join(', ') || 'TypeScript'}.

Projeto: ${context.summary}

Arquivos alterados:
${stat.trim()}

Diff staged:
${truncateForPrompt(diff, MAX_DIFF_CHARS)}

Já encontrados por checagem automática (NÃO repita):
${alreadyFound.length > 0 ? alreadyFound.join('\n') : '(nada)'}

Revise APENAS as linhas adicionadas (+). Procure principalmente:
- bugs de lógica: índice fora do array, condição invertida, valor nulo/undefined não tratado, await esquecido
- segurança: dados sensíveis, entrada do usuário sem validação
- tipos: parâmetros ou retornos sem tipo, conversões inseguras

Responda em português, em lista, um problema por item, no formato:
- [bug|segurança|estilo|melhoria] arquivo:trecho — problema — sugestão concreta

Regras:
- No máximo ${MAX_AI_FINDINGS} itens, do mais grave para o menos grave, sem repetir o mesmo problema
- Antes de apontar algo, confira no diff que é verdade (ex.: não diga que falta um tipo que está escrito)
- Não elogie e não resuma o diff
- Se não houver nada além do que já foi encontrado, responda exatamente: ${NO_ISSUES}`;
}

// Local models repeat the same item over and over: keep list items, drop duplicates, cap the count.
function normalizeFindings(response: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const line of answerLines(response)) {
    if (!line.startsWith('[')) continue;
    const key = line.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(`- ${line}`);
  }

  return items.slice(0, MAX_AI_FINDINGS);
}

export async function runReview(): Promise<void> {
  const diff = getDiff();

  if (!diff.trim()) {
    console.log('Nenhuma mudança staged para revisar. Use "git add" antes.');
    return;
  }

  const context = await loadContext();
  const automatic = runReviewChecks(diff);

  if (automatic.length > 0) {
    console.log('\n🧪 Checagens automáticas:');
    automatic.forEach((finding) => console.log(finding));
  }

  const response = await askFor('review', buildReviewPrompt(context, diff, getDiffStat(), automatic), {
    temperature: 0.2,
    repeatPenalty: 1.2,
    maxTokens: REVIEW_MAX_TOKENS,
  });
  const findings = normalizeFindings(response);

  console.log('\n🔎 Revisão da IA:');
  console.log(findings.length > 0 ? findings.join('\n') : NO_ISSUES);

  // The review only suggests; applying is up to the developer (see Doc/kvasir-current.md #3).
  const useful = await confirm('As sugestões foram úteis?');
  const summary = [...automatic, ...findings][0] ?? NO_ISSUES;
  await recordFeedback('patterns', useful ? 'approved' : 'rejected', `review: ${summary}`);
  console.log('Feedback registrado.');
}
