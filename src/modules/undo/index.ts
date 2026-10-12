import { confirm } from '@utils/prompt';
import { undoLastCommit } from '@utils/git';

export async function runUndo(): Promise<void> {
  const approved = await confirm('Desfazer o último commit (git reset HEAD~1 --soft)?');
  if (!approved) {
    console.log('Operação cancelada.');
    return;
  }

  undoLastCommit();
  console.log('Mudanças voltaram para staged.');
}
