import { getDiff, commitWithMessage, stageAll, getCurrentBranch, mergeBranchInto } from '@utils/git';
import { askFor } from '@ai/router';
import { confirm, editor, select, input } from '@utils/prompt';
import { loadContext } from '@modules/init/contextWriter';
import { recordFeedback } from '@utils/feedback';
import { runPush } from '@modules/push';
import { runUndo } from '@modules/undo';
import { runLog } from '@modules/log';

type CommitChoice = 'yes' | 'no' | 'edit';
type PostCommitAction = 'push' | 'undo' | 'log' | 'merge' | 'none';

function buildCommitPrompt(diff: string): string {
  return `Você é um especialista em Git. Analise o diff abaixo e gere
UMA mensagem de commit seguindo Conventional Commits em inglês.

Formato obrigatório: <type>(<scope>): <description>
Tipos válidos: feat, fix, docs, style, refactor, perf, test, ci, chore, revert
- type: categoria da mudança
- scope: arquivo ou módulo afetado (opcional)
- description: imperativo, máximo 72 chars, em inglês

Responda APENAS com a mensagem de commit. Nada mais.

Diff:
${diff}

Responda APENAS com a mensagem de commit em uma única linha
em inglês. Sem explicações, sem bullets, sem markdown, sem aspas.`;
}

async function runPostCommitMenu(): Promise<void> {
  let keepGoing = true;

  while (keepGoing) {
    const action = await select<PostCommitAction>('O que quer fazer agora?', [
      { name: 'Push para o repositório remoto', value: 'push' },
      { name: 'Desfazer commit (git reset HEAD~1 --soft)', value: 'undo' },
      { name: 'Ver histórico (git log --oneline -10)', value: 'log' },
      { name: 'Fazer merge em outra branch', value: 'merge' },
      { name: 'Nada — terminar aqui', value: 'none' },
    ]);

    switch (action) {
      case 'push':
        await runPush();
        break;

      case 'undo':
        await runUndo();
        break;

      case 'log':
        await runLog();
        break;

      case 'merge': {
        const currentBranch = getCurrentBranch();
        const targetBranch = await input('Em qual branch deseja fazer merge?');
        if (!targetBranch.trim()) {
          console.log('Nenhuma branch informada. Merge cancelado.');
          break;
        }
        mergeBranchInto(targetBranch.trim(), currentBranch);
        console.log(`✅ Merge de ${currentBranch} em ${targetBranch.trim()} concluído.`);
        break;
      }

      case 'none':
        keepGoing = false;
        break;

      default:
        break;
    }
  }
}

export async function runCommit(): Promise<void> {
  let diff = getDiff();

  if (!diff.trim()) {
    const shouldStage = await confirm('Nenhuma mudança staged. Rodar git add . agora?');
    if (shouldStage) {
      stageAll();
      diff = getDiff();
    }

    if (!diff.trim()) {
      console.log('Nenhuma mudança staged para commitar.');
      return;
    }
  }

  await loadContext();

  const response = await askFor('commit', buildCommitPrompt(diff));

  const message = (() => {
    const backtickMatch = response.match(/`([^`]+)`/);
    if (backtickMatch) return backtickMatch[1].trim();

    const firstLine = response
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('Here'));

    return firstLine ?? response.trim();
  })();

  console.log('\n📝 Mensagem sugerida:');
  console.log(`\n   ${message}\n`);

  const action = await select<CommitChoice>('Usar esta mensagem?', [
    { name: 'Sim — commitar', value: 'yes' },
    { name: 'Não — cancelar', value: 'no' },
    { name: 'Editar — modificar antes de commitar', value: 'edit' },
  ]);

  if (action === 'no') {
    await recordFeedback('commits', 'rejected', message);
    console.log('❌ Commit cancelado.');
    return;
  }

  let finalMessage = message;

  if (action === 'edit') {
    finalMessage = (await editor('Editar a mensagem de commit', message)).trim();
    await recordFeedback('commits', 'rejected', message);
  } else {
    await recordFeedback('commits', 'approved', message);
  }

  if (!finalMessage) {
    console.log('Mensagem de commit vazia. Commit cancelado.');
    return;
  }

  commitWithMessage(finalMessage);
  console.log('✅ Commit realizado com sucesso!');

  await runPostCommitMenu();
}
