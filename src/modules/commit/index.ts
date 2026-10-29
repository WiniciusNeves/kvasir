import {
  getDiff,
  getDiffStat,
  getHeadShortHash,
  getStagedPaths,
  commitWithMessage,
  stageAll,
  getCurrentBranch,
  mergeBranchInto,
  checkoutBranch,
} from '@utils/git';
import { printCliError } from '@utils/errors';
import { askFor } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { recordExample } from '@ai/examples';
import { describeCommitFiles, learnFromCommitHistory } from '@modules/learn/history';
import { answerLines, pickLine, truncateForPrompt } from '@ai/parse';
import { confirm, editor, select, input } from '@utils/prompt';
import { loadContext } from '@modules/init/ensure';
import { recordFeedback } from '@utils/feedback';
import { runPush } from '@modules/push';
import { confirmAndUndoLastCommit } from '@modules/undo';
import { runLog } from '@modules/log';
import { noteCommit } from '@modules/knowledge/auto';
import { offerBranchForTask, offerReviewBeforeCommit, offerDocNewLib } from '@modules/proactive/suggestions';
import { guardStagedChanges } from '@modules/guard';

type CommitChoice = 'yes' | 'no' | 'edit';
type PostCommitAction = 'push' | 'undo' | 'log' | 'merge' | 'none';

// Big diffs overflow the local model's context and produce generic messages: send the --stat
// (every file) plus a truncated diff.
const MAX_DIFF_CHARS = 12_000;
const CONVENTIONAL_COMMIT = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([\w./-]+\))?!?: \S.*$/;

// The commit language comes from the project's persona (kvasir.context.md → Commit rules).
function describeLanguage(language: string): { name: string; imperative: string } {
  return /portugu/i.test(language)
    ? { name: 'português do Brasil', imperative: 'no imperativo ("adiciona", "corrige", "remove"; não "adicionado")' }
    : { name: 'inglês', imperative: 'no imperativo ("add", "fix", "remove"; não "added")' };
}

function buildCommitPrompt(diff: string, stat: string, commitLanguage: string): string {
  const language = describeLanguage(commitLanguage);
  return `Você escreve mensagens de commit no padrão Conventional Commits, em ${language.name}.

Arquivos alterados (git diff --cached --stat):
${stat.trim()}

Diff:
${truncateForPrompt(diff, MAX_DIFF_CHARS)}

Gere UMA mensagem de commit para essas mudanças.

Formato: <type>(<scope>): <description>
- type: feat (funcionalidade nova), fix (correção de bug), docs, style, refactor, perf, test, build, ci, chore, revert
- scope: opcional, o módulo ou pasta principal afetado (ex.: o nome da pasta em src/)
- description: em ${language.name}, ${language.imperative}, letra minúscula, sem ponto final, até 72 caracteres
- Descreva O QUE mudou de verdade no diff, não invente

Responda com UMA única linha: só a mensagem. Sem aspas, sem markdown, sem explicação.`;
}

function parseCommitMessage(response: string): string {
  return pickLine(response, CONVENTIONAL_COMMIT) ?? answerLines(response)[0] ?? response.trim();
}

async function runMergeIntoOtherBranch(): Promise<void> {
  const currentBranch = getCurrentBranch();
  const targetBranch = (await input('Em qual branch deseja fazer merge?')).trim();
  if (!targetBranch) {
    console.log('Nenhuma branch informada. Merge cancelado.');
    return;
  }

  const approved = await confirm(`Trocar para ${targetBranch} e fazer merge de ${currentBranch} nela?`);
  if (!approved) {
    console.log('Merge cancelado.');
    return;
  }

  mergeBranchInto(targetBranch, currentBranch);
  console.log(`✅ Merge de ${currentBranch} em ${targetBranch} concluído.`);

  if (await confirm(`Voltar para ${currentBranch}?`)) {
    checkoutBranch(currentBranch);
  }
}

// Loops until "none". After an undo the commit no longer exists, so push/merge make no sense: the menu ends.
// A failing git action prints the error and returns to the menu instead of aborting the command.
async function runPostCommitMenu(): Promise<void> {
  for (;;) {
    const action = await select<PostCommitAction>('O que quer fazer agora?', [
      { name: 'Push para o repositório remoto', value: 'push' },
      { name: 'Desfazer commit (git reset HEAD~1 --soft)', value: 'undo' },
      { name: 'Ver histórico (git log --oneline -10)', value: 'log' },
      { name: 'Fazer merge em outra branch', value: 'merge' },
      { name: 'Nada — terminar aqui', value: 'none' },
    ]);

    if (action === 'none') return;

    try {
      if (action === 'push') await runPush();
      if (action === 'log') await runLog();
      if (action === 'merge') await runMergeIntoOtherBranch();
      if (action === 'undo') {
        const undone = await confirmAndUndoLastCommit();
        if (undone) return;
      }
    } catch (error) {
      printCliError(error);
    }
  }
}

export interface CommitOptions {
  // commander turns --no-guard into guard: false
  guard?: boolean;
}

export async function runCommit(options: CommitOptions = {}): Promise<void> {
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

  const context = await loadContext();

  // Security gate before anything reaches a model or the history.
  if (options.guard !== false) {
    const allowed = await guardStagedChanges();
    if (!allowed) return;

    diff = getDiff();
    if (!diff.trim()) {
      console.log('Nada sobrou no stage para commitar.');
      return;
    }
  } else {
    console.log('⚠️  kvasir guard pulado (--no-guard).');
  }

  // Proactive (one suggestion at most): branch for the active task, then review of a big change.
  if (await offerBranchForTask(context)) {
    diff = getDiff();
  } else if (await offerReviewBeforeCommit(diff)) {
    if (!(await confirm('Continuar com o commit?'))) return;
    diff = getDiff();
  }
  if (!diff.trim()) {
    console.log('Nada no stage para commitar.');
    return;
  }

  // the developer's own commits are the style examples (incremental: only the new ones are read)
  const { learned } = await learnFromCommitHistory();
  if (learned > 0) console.log(`📚 Aprendi o seu estilo com ${learned} commit(s) seus deste projeto.`);
  const about = describeCommitFiles(getStagedPaths());

  const response = await askFor('commit', buildCommitPrompt(diff, getDiffStat(), context.commitRules.language), { temperature: 0.2, examplesFor: about });
  const message = parseCommitMessage(response);

  console.log('\n📝 Mensagem sugerida:');
  console.log(`\n   ${message}\n`);
  if (!CONVENTIONAL_COMMIT.test(message)) {
    console.log('⚠️  A mensagem não segue Conventional Commits. Considere editar.\n');
  } else if (message.length > 72) {
    console.log(`⚠️  A mensagem tem ${message.length} caracteres (máximo recomendado: 72).\n`);
  }

  const action = await select<CommitChoice>('Usar esta mensagem?', [
    { name: 'Sim — commitar', value: 'yes' },
    { name: 'Não — cancelar', value: 'no' },
    { name: 'Editar — modificar antes de commitar', value: 'edit' },
  ]);

  if (action === 'no') {
    await recordFeedback('commits', 'rejected', message);
    await recordOutcome('commit', 'rejected');
    await recordExample('commit', { input: about, output: message, decision: 'rejected' });
    console.log('❌ Commit cancelado.');
    return;
  }

  let finalMessage = message;

  if (action === 'edit') {
    finalMessage = (await editor('Editar a mensagem de commit', message)).trim();
  }
  // "Editar" that keeps the suggested message is an approval, like the example below
  const verdict = finalMessage === message ? 'approved' : 'rejected';
  await recordFeedback('commits', verdict, message);
  await recordOutcome('commit', verdict);

  if (!finalMessage) {
    console.log('Mensagem de commit vazia. Commit cancelado.');
    return;
  }
  // what the developer kept is the lesson: the edited version (with the suggestion it replaced) or the approved one
  await recordExample(
    'commit',
    finalMessage !== message ? { input: about, output: finalMessage, suggested: message, decision: 'edited' } : { input: about, output: message, decision: 'approved' }
  );

  commitWithMessage(finalMessage);
  console.log('✅ Commit realizado com sucesso!');
  await noteCommit(finalMessage, getHeadShortHash(), getCurrentBranch());
  await offerDocNewLib(diff);

  await runPostCommitMenu();
}
