import { select } from '@utils/prompt';
import { getCurrentBranch, pushCurrentBranch } from '@utils/git';

type PushMode = 'normal' | 'force' | 'cancel';

export async function runPush(): Promise<void> {
  const currentBranch = getCurrentBranch();

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
  pushCurrentBranch(currentBranch, { forceWithLease });
  console.log(`✅ Push${forceWithLease ? ' (--force-with-lease)' : ''} enviado para origin/${currentBranch}.`);
}
