import { createHash } from 'crypto';
import type { KvasirContext } from '@ktypes/context';
import { countChangedLines, parseAddedDependencies } from '@utils/diff';
import { getCurrentBranch, getLocalBranchAges, countUnmergedCommits, deleteBranch, refExists } from '@utils/git';
import { readNote } from '@modules/knowledge/notes';
import { offerSuggestion, readProactiveState, writeProactiveState } from './index';

// The facts behind each suggestion, computed by code. Each offer* returns true when it ran.

const MAIN_BRANCHES = ['main', 'master', 'develop'];
const REVIEW_MIN_LINES = 80;
const STALE_DAYS = 14;
const DAY_SECONDS = 24 * 60 * 60;

function hashDiff(diff: string): string {
  return createHash('sha256').update(diff.replace(/\r/g, '')).digest('hex');
}

// Called by `kvasir review`: this staged diff was already reviewed, don't suggest it again.
export async function markDiffReviewed(diff: string): Promise<void> {
  const state = await readProactiveState();
  state.reviewedDiff = hashDiff(diff);
  await writeProactiveState(state);
}

export async function offerBranchForTask(context: KvasirContext): Promise<boolean> {
  const branch = getCurrentBranch();
  if (!context.activeTask || !MAIN_BRANCHES.includes(branch)) return false;

  return offerSuggestion({
    id: 'branch-for-task',
    question: `Você está na ${branch} com a task ${context.activeTask.id} ativa. Criar a branch da task agora?`,
    action: 'Criando a branch da task',
    run: async () => {
      // lazy import: branch → init → … would be a cycle at load time
      const { runBranch } = await import('@modules/branch');
      await runBranch();
    },
  });
}

export async function offerReviewBeforeCommit(diff: string): Promise<boolean> {
  const lines = countChangedLines(diff);
  if (lines < REVIEW_MIN_LINES) return false;
  if ((await readProactiveState()).reviewedDiff === hashDiff(diff)) return false;

  return offerSuggestion({
    id: 'review-before-commit',
    question: `São ${lines} linhas alteradas e ainda sem review. Revisar antes de commitar?`,
    action: `Revisando as ${lines} linhas antes do commit`,
    run: async () => {
      const { runReview } = await import('@modules/review');
      await runReview();
    },
  });
}

export async function offerDocNewLib(diff: string): Promise<boolean> {
  const added = parseAddedDependencies(diff).filter((name) => !name.startsWith('@types/'));
  for (const lib of added) {
    if (await readNote('libs', lib)) continue;
    return offerSuggestion({
      id: 'doc-new-lib',
      key: lib,
      question: `Você adicionou "${lib}". Documentar agora (kvasir doc ${lib})?`,
      action: `Documentando a lib nova "${lib}"`,
      run: async () => {
        const { runDoc } = await import('@modules/doc');
        await runDoc(lib);
      },
    });
  }
  return false;
}

export async function offerStaleBranch(): Promise<boolean> {
  const current = getCurrentBranch();
  const base = MAIN_BRANCHES.find((name) => refExists(name)) ?? null;
  const now = Date.now() / 1000;
  const dismissed = (await readProactiveState()).suggestions['stale-branch']?.dismissed ?? [];

  const stale = getLocalBranchAges().find(
    (branch) => !MAIN_BRANCHES.includes(branch.name) && branch.name !== current && !dismissed.includes(branch.name) && now - branch.lastCommitAt >= STALE_DAYS * DAY_SECONDS
  );
  if (!stale) return false;

  const days = Math.floor((now - stale.lastCommitAt) / DAY_SECONDS);
  const unmerged = base ? countUnmergedCommits(stale.name, base) : -1;
  const status =
    unmerged === 0 ? `já está toda na ${base}` : unmerged > 0 ? `tem ${unmerged} commit(s) que não estão na ${base}` : 'sem base para comparar';

  return offerSuggestion({
    id: 'stale-branch',
    key: stale.name,
    question: `A branch "${stale.name}" está parada há ${days} dias e ${status}. Apagar?`,
    action: `Apagando a branch parada "${stale.name}"`,
    run: async () => {
      // -d only: git refuses when there is unmerged work, and we never force it from a suggestion
      const result = deleteBranch(stale.name, false);
      if (result.success) console.log(`🗑️  Branch "${stale.name}" apagada.`);
      else console.log(`Não apaguei: a branch tem trabalho que não foi mergeado. Se quiser mesmo: kvasir branch -d`);
    },
  });
}
