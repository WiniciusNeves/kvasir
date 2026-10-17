import { getDiff, getDiffStat } from '@utils/git';
import { askFor } from '@ai/router';
import { cleanAnswer, truncateForPrompt } from '@ai/parse';
import { confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';
import type { KvasirContext } from '@ktypes/context';

const MAX_DIFF_CHARS = 12_000;

function buildReviewPrompt(context: KvasirContext, diff: string, stat: string): string {
  return `Você é um revisor de código sênior em ${context.project.stack.join(', ') || 'TypeScript'}.

Projeto: ${context.summary}
Convenção de commit: ${context.commitRules.format} (${context.commitRules.convention}, ${context.commitRules.language})
Convenção de branch: ${context.branchRules.pattern} (${context.branchRules.prefix})

Arquivos alterados:
${stat.trim()}

Diff staged:
${truncateForPrompt(diff, MAX_DIFF_CHARS)}

Revise APENAS as linhas adicionadas/alteradas (+) do diff acima.

Responda em português, em uma lista. Cada item no formato:
- [bug|segurança|estilo|melhoria] arquivo:trecho — problema — sugestão concreta

Regras:
- Ordene do mais grave para o menos grave; no máximo 10 itens
- Só aponte o que dá para ver no diff; não invente arquivos, funções ou linhas
- Não elogie e não resuma o diff
- Se não houver nenhum problema, responda exatamente: Nenhum problema encontrado.`;
}

export async function runReview(): Promise<void> {
  const diff = getDiff();

  if (!diff.trim()) {
    console.log('Nenhuma mudança staged para revisar. Use "git add" antes.');
    return;
  }

  const context = await loadContext();
  const findings = cleanAnswer(await askFor('review', buildReviewPrompt(context, diff, getDiffStat()), { temperature: 0.2 }));

  console.log('\n🔎 Revisão:');
  console.log(findings);

  // The review only suggests; applying is up to the developer (see Doc/kvasir-current.md #3).
  const useful = await confirm('As sugestões foram úteis?');
  await recordFeedback('patterns', useful ? 'approved' : 'rejected', `review: ${findings.split('\n')[0]}`);
  console.log('Feedback registrado.');
}
