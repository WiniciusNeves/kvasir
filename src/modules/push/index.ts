import { select } from '@utils/prompt';
import { getCurrentBranch, getUpstream, hasRemote, listUnpushedCommits, pushCurrentBranch, pushWithUpstream } from '@utils/git';

type PushMode = 'normal' | 'force' | 'cancel';

const MAX_LISTED_COMMITS = 10;

export async function runPush(): Promise<void> {
  if (!hasRemote('origin')) throw new Error('Este repositório não tem o remoto "origin". Adicione com: git remote add origin <url>');

  const currentBranch = getCurrentBranch();
  const upstream = getUpstream();
  const commits = listUnpushedCommits();

  // What goes up, before asking (the first push of a branch also sets its upstream)
  if (upstream && commits.length === 0) {
    console.log(`Nada para enviar: ${currentBranch} já está em ${upstream}.`);
    return;
  }
  console.log(`\n${commits.length} commit(s) para enviar${upstream ? '' : ` (branch nova: vai seguir origin/${currentBranch})`}:`);
  commits.slice(0, MAX_LISTED_COMMITS).forEach((commit) => console.log(`  ${commit}`));
  if (commits.length > MAX_LISTED_COMMITS) console.log(`  … e mais ${commits.length - MAX_LISTED_COMMITS}`);

  const mode = await select<PushMode>(`Push de ${currentBranch} para origin?`, [
    { name: 'Push normal', value: 'normal' },
    { name: 'Push com --force-with-lease', value: 'force' },
    { name: 'Cancelar', value: 'cancel' },
  ]);

  if (mode === 'cancel') {
    console.log('Push cancelado.');
    return;
  }

  const forceWithLease = mode === 'force';
  if (upstream) pushCurrentBranch(currentBranch, { forceWithLease });
  else pushWithUpstream(currentBranch);
  console.log(`✅ Push${forceWithLease ? ' (--force-with-lease)' : ''} enviado para origin/${currentBranch}.`);
}
