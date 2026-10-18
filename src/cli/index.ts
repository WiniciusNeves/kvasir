#!/usr/bin/env node
import { Command } from 'commander';
import { registerInit } from './init';
import { registerBranch } from './branch';
import { registerCommit } from './commit';
import { registerFix } from './fix';
import { registerFormat } from './format';
import { registerDoc } from './doc';
import { registerTask } from './task';
import { registerReview } from './review';
import { registerKnowledge } from './knowledge';
import { registerStart } from './start';
import { registerLearn } from './learn';
import { registerUndo } from './undo';
import { registerPush } from './push';
import { registerLog } from './log';
import { registerModels } from './models';
import { registerGuard } from './guard';
import { registerDoctor } from './doctor';
import { registerPr } from './pr';
import { registerDaily } from './daily';
import { registerRelease } from './release';
import { registerTest } from './test';
import { registerPersona } from './persona';
import { registerKeys } from './keys';
import { resolveCommandLine } from '@modules/menu';
import { printCliError } from '@utils/errors';

process.on('SIGINT', () => {
  console.log('\n👋 Kvasir encerrado.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

const program = new Command();

program.name('kvasir').description('Kvasir — modular productivity ecosystem for developers').version('0.1.0');

registerInit(program);
registerBranch(program);
registerCommit(program);
registerFix(program);
registerFormat(program);
registerDoc(program);
registerTask(program);
registerReview(program);
registerKnowledge(program);
registerStart(program);
registerLearn(program);
registerUndo(program);
registerPush(program);
registerLog(program);
registerModels(program);
registerGuard(program);
registerDoctor(program);
registerPr(program);
registerDaily(program);
registerRelease(program);
registerTest(program);
registerPersona(program);
registerKeys(program);

program.addHelpText(
  'after',
  '\nDicas: rode só "kvasir" para abrir o menu, ou escreva o que quer: kvasir quero salvar minha chave do groq'
);

// No args → menu; a typo or a sentence → the matching command (after a confirmation).
async function main(): Promise<void> {
  const knownCommands = program.commands.map((command) => command.name());
  const argv = await resolveCommandLine(process.argv.slice(2), knownCommands);
  if (argv) await program.parseAsync(argv, { from: 'user' });
}

main().catch((error: unknown) => {
  if ((error as Error).name === 'ExitPromptError') return;
  printCliError(error);
});
