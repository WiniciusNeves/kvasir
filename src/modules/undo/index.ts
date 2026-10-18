import { confirm } from '@utils/prompt';
import { undoLastCommit } from '@utils/git';

// Returns whether the commit was undone (the post-commit menu closes after an undo).
export async function confirmAndUndoLastCommit(): Promise<boolean> {
  const approved = await confirm('Desfazer o último commit (git reset HEAD~1 --soft)?');
  if (!approved) {
    console.log('Operação cancelada.');
    return false;
  }

  undoLastCommit();
  console.log('Mudanças voltaram para staged.');
  return true;
}

export async function runUndo(): Promise<void> {
  await confirmAndUndoLastCommit();
}
