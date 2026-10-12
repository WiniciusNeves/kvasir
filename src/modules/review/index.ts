import { getDiff } from '@utils/git';
import { askFor } from '@ai/router';
import { confirm } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';

export async function runReview(): Promise<void> {
  const diff = getDiff();

  if (!diff.trim()) {
    console.log('Nenhuma mudança staged para revisar.');
    return;
  }

  const context = await loadContext();

  const findings = await askFor('review', `
    Project: ${context.summary}
    Stack: ${context.project.stack.join(', ')}
    Commit convention: ${context.commitRules.format} (${context.commitRules.convention}, ${context.commitRules.language})
    Branch convention: ${context.branchRules.pattern} (${context.branchRules.prefix})

    Review the following staged diff against the project's conventions above.
    Point out bugs, style violations, and concrete improvements.

    Diff:
    ${diff}
  `);

  console.log('\nProblemas encontrados:');
  console.log(findings);

  const approved = await confirm('Aplicar estas sugestões?');
  await recordFeedback('patterns', approved ? 'approved' : 'rejected', 'Code review suggestions');

  if (!approved) {
    console.log('Feedback registrado como rejeitado.');
    return;
  }

  console.log('Feedback registrado como aprovado.');
}
