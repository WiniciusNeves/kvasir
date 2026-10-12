import { select } from '@utils/prompt';
import { getCurrentBranch, pushCurrentBranch } from '@utils/git';

type PushMode = 'normal' | 'force';

export async function runPush(): Promise<void> {
  const mode = await select<PushMode>('Como deseja fazer o push?', [
    { name: 'Push normal', value: 'normal' },
    { name: 'Push com --force-with-lease', value: 'force' },
  ]);

  const currentBranch = getCurrentBranch();
  const forceWithLease = mode === 'force';

  pushCurrentBranch(currentBranch, { forceWithLease });
  console.log(`✅ Push${forceWithLease ? ' (--force-with-lease)' : ''} enviado para origin/${currentBranch}.`);
}
