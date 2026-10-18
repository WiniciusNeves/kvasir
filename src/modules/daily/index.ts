import path from 'path';
import { askLocal } from '@ai/router';
import { writeClipboard } from '@ai/client';
import { recordOutcome } from '@ai/metrics';
import { confirm, editor, input, select } from '@utils/prompt';
import { getCommitsByAuthor, getGitConfigIn } from '@utils/git';
import { readContext } from '@modules/init/contextWriter';
import { noteDaily } from '@modules/knowledge/auto';
import { getConfiguredRepos, saveRepos, findRepos, currentRepo, getConfigLocation } from './config';
import { computePeriod, buildYesterdayPrompt, parseYesterday, splitItems, buildDailyMessage } from './summary';
import type { RepoCommits, DailyPeriod } from './summary';

export interface DailyOptions {
  since?: string;
  repos?: string;
}

type DailyAction = 'copy' | 'edit' | 'regenerate' | 'cancel';

async function resolveRepos(options: DailyOptions): Promise<string[]> {
  if (options.repos) {
    const found = findRepos(options.repos);
    if (found.length === 0) throw new Error(`Nenhum repositório git em ${path.resolve(options.repos)}.`);
    console.log(`📂 ${found.length} repositório(s) em ${path.resolve(options.repos)}`);
    if (await confirm(`Salvar essa lista em ${getConfigLocation()} para as próximas dailies?`)) await saveRepos(found);
    return found;
  }

  const configured = await getConfiguredRepos();
  if (configured.length > 0) return configured;

  const here = currentRepo();
  if (!here) {
    throw new Error('Nenhum repositório configurado. Rode dentro de um repositório ou use "kvasir daily --repos <pasta>".');
  }
  if (await confirm(`Usar ${here} nas próximas dailies (salva em ${getConfigLocation()})?`)) await saveRepos([here]);
  return [here];
}

function collectCommits(repos: string[], period: DailyPeriod): RepoCommits[] {
  return repos.map((repo) => {
    const author = getGitConfigIn(repo, 'user.email') || getGitConfigIn(repo, 'user.name');
    return { repo, commits: author ? getCommitsByAuthor(repo, author, period.gitSince) : [] };
  });
}

async function readActiveTaskTitle(): Promise<string | undefined> {
  try {
    const context = await readContext();
    return context.activeTask ? `Seguir com ${context.activeTask.id} — ${context.activeTask.title}` : undefined;
  } catch {
    return undefined;
  }
}

async function writeYesterday(repos: RepoCommits[], period: DailyPeriod): Promise<string[]> {
  const total = repos.reduce((sum, entry) => sum + entry.commits.length, 0);
  if (total === 0) {
    return splitItems(await input(`Nenhum commit seu ${period.label}. O que você fez? (separe itens com ";")`));
  }
  console.log('🤖 Resumindo os commits...');
  return parseYesterday(await askLocal('daily', buildYesterdayPrompt(repos, period), { temperature: 0.3 }), repos);
}

export async function runDaily(options: DailyOptions = {}): Promise<void> {
  const repos = await resolveRepos(options);
  const period = computePeriod(new Date(), options.since);
  const commits = collectCommits(repos, period);

  console.log(`\n🗓️  Commits ${period.label}:`);
  commits.forEach((entry) => console.log(`  ${path.basename(entry.repo)}: ${entry.commits.length}`));

  let yesterday = await writeYesterday(commits, period);
  const today = splitItems(await input('Hoje (separe itens com ";"):', await readActiveTaskTitle()));
  const blockers = splitItems(await input('Impedimentos:', 'Nenhum')).filter((item) => !/^nenhum$/i.test(item));

  let message = buildDailyMessage({ date: new Date(), yesterday, today, blockers });

  for (;;) {
    console.log(`\n${'─'.repeat(50)}\n${message}\n${'─'.repeat(50)}`);

    const action = await select<DailyAction>('O que fazer?', [
      { name: 'Copiar para o clipboard', value: 'copy' },
      { name: 'Editar antes', value: 'edit' },
      { name: 'Gerar o "Ontem" de novo', value: 'regenerate' },
      { name: 'Cancelar', value: 'cancel' },
    ]);

    if (action === 'edit') {
      message = (await editor('Editar a daily', message)).trim() || message;
      continue;
    }

    if (action === 'regenerate' || action === 'cancel') {
      await recordOutcome('daily', 'rejected');
      if (action === 'cancel') return;
      yesterday = await writeYesterday(commits, period);
      message = buildDailyMessage({ date: new Date(), yesterday, today, blockers });
      continue;
    }

    await recordOutcome('daily', 'approved');
    await writeClipboard(message);
    console.log('✅ Daily copiada. É só colar no chat do time.');
    await noteDaily(message);
    return;
  }
}
