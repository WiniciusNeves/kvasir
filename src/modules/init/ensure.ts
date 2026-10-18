import { pathExists } from '@utils/fs';
import { confirm } from '@utils/prompt';
import type { KvasirContext } from '@ktypes/context';
import { readContext } from './contextWriter';
import { runInit } from './index';

const CONTEXT_FILE = 'kvasir.context.md';

// What runners call when they need the project context: instead of failing with "run kvasir init
// first", it offers to run init right there and continues with the new context.
export async function loadContext(): Promise<KvasirContext> {
  if (!(await pathExists(CONTEXT_FILE))) {
    console.log(`\nEste projeto ainda não tem o ${CONTEXT_FILE} (é o kvasir init que cria).`);
    if (!(await confirm('Rodar o kvasir init agora?'))) {
      throw new Error(`Sem o ${CONTEXT_FILE} não dá para continuar. Quando quiser: kvasir init`);
    }
    await runInit();
    if (!(await pathExists(CONTEXT_FILE))) throw new Error(`O kvasir init terminou sem criar o ${CONTEXT_FILE}.`);
    console.log('');
  }
  return readContext();
}
