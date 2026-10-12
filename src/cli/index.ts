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

program.parse(process.argv);
