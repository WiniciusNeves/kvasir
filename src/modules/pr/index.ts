import os from 'os';
import path from 'path';
import { askFor } from '@ai/router';
import { writeClipboard } from '@ai/client';
import { recordOutcome } from '@ai/metrics';
import { confirm, editor, select } from '@utils/prompt';
import { writeFile, removeFile } from '@utils/fs';
import { runCommand, commandExists } from '@utils/process';
import {
  getCurrentBranch,
  refExists,
  getCommitsSince,
  getDiffAgainst,
  getDiffStatAgainst,
  getChangedFilesAgainst,
  getUpstream,
  pushWithUpstream,
} from '@utils/git';
import { loadContext } from '@modules/init/ensure';
import { notePullRequest } from '@modules/knowledge/auto';
import { baseCandidates, typeForBranch, hasUiChanges, buildPrPrompt, parsePrDraft, buildPrBody } from './description';
import type { PrFacts } from './description';

type PrAction = 'copy' | 'create' | 'edit' | 'regenerate' | 'cancel';

interface PrText {
  title: string;
  body: string;
}

async function chooseBase(branch: string): Promise<string> {
  const available = baseCandidates(branch).filter((ref) => refExists(ref) && ref.replace(/^origin\//, '') !== branch);
  if (available.length === 0) {
    throw new Error('Não encontrei develop, main nem master (local ou origin). Crie a branch base ou rode "git fetch".');
  }
  if (available.length === 1) return available[0];

  return select<string>(
    'Branch base do PR:',
    available.map((ref, index) => ({ name: index === 0 ? `${ref} (sugerida pelo Git Flow)` : ref, value: ref }))
  );
}

function showPr(text: PrText): void {
  console.log('\n' + '─'.repeat(70));
  console.log(text.title);
  console.log('─'.repeat(70));
  console.log(text.body);
  console.log('─'.repeat(70));
}

// The editor holds "title\n\nbody": first non-empty line is the title.
function parseEdited(content: string, fallback: PrText): PrText {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex < 0) return fallback;
  return { title: lines[titleIndex].trim(), body: lines.slice(titleIndex + 1).join('\n').trim() };
}

async function createWithGh(text: PrText, facts: PrFacts): Promise<string | null> {
  if (!getUpstream()) {
    const push = await confirm(`A branch ${facts.branch} ainda não está no remoto. Fazer "git push -u origin ${facts.branch}"?`);
    if (!push) return null;
    pushWithUpstream(facts.branch);
  }

  const base = facts.base.replace(/^origin\//, '');
  const approved = await confirm(`Criar o PR "${text.title}" de ${facts.branch} para ${base}?`);
  if (!approved) return null;

  // --body-file: the body has quotes, backticks and newlines that don't survive a command line.
  const bodyFile = path.join(os.tmpdir(), `kvasir-pr-${Date.now()}.md`);
  await writeFile(bodyFile, text.body);
  try {
    const result = runCommand('gh', ['pr', 'create', '--base', base, '--head', facts.branch, '--title', text.title, '--body-file', bodyFile]);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    if (result.status !== 0) throw new Error(`gh pr create falhou: ${output}`);
    return output.match(/https:\/\/\S+/)?.[0] ?? output;
  } finally {
    await removeFile(bodyFile);
  }
}

export async function runPr(): Promise<void> {
  const context = await loadContext();
  const branch = getCurrentBranch();
  if (!branch) throw new Error('Não estou numa branch (HEAD destacado?).');

  const base = await chooseBase(branch);
  const commits = getCommitsSince(base);
  if (commits.length === 0) {
    console.log(`Nenhum commit em ${branch} que não esteja em ${base}. Nada para o PR.`);
    return;
  }

  const facts: PrFacts = {
    branch,
    base,
    type: typeForBranch(branch),
    commits,
    stat: getDiffStatAgainst(base),
    diff: getDiffAgainst(base),
    hasUiChanges: hasUiChanges(getChangedFilesAgainst(base)),
    task: context.activeTask ? { id: context.activeTask.id, title: context.activeTask.title } : null,
  };

  console.log(`\n📦 ${branch} → ${base}: ${commits.length} commit(s)${facts.hasUiChanges ? ', com mudanças de tela' : ''}`);
  const ghAvailable = commandExists('gh');
  if (!ghAvailable) console.log('ℹ️  GitHub CLI (gh) não instalado: dá para copiar a descrição; para criar o PR daqui, veja "kvasir doctor".');
  let text: PrText | null = null;

  for (;;) {
    if (!text) {
      const draft = parsePrDraft(await askFor('pr', buildPrPrompt(facts), { temperature: 0.3 }), facts.type);
      text = { title: draft.title, body: buildPrBody(draft, facts) };
    }
    showPr(text);

    const action = await select<PrAction>('O que fazer?', [
      { name: 'Copiar título + descrição para o clipboard', value: 'copy' },
      ...(ghAvailable ? [{ name: 'Criar o PR no GitHub (gh pr create)', value: 'create' as const }] : []),
      { name: 'Editar antes', value: 'edit' },
      { name: 'Gerar de novo', value: 'regenerate' },
      { name: 'Cancelar', value: 'cancel' },
    ]);

    if (action === 'edit') {
      text = parseEdited(await editor('Editar o PR (1ª linha = título)', `${text.title}\n\n${text.body}`), text);
      continue;
    }

    if (action === 'regenerate' || action === 'cancel') {
      await recordOutcome('pr', 'rejected');
      if (action === 'cancel') return;
      text = null;
      continue;
    }

    await recordOutcome('pr', 'approved');

    if (action === 'copy') {
      await writeClipboard(`${text.title}\n\n${text.body}`);
      console.log('✅ Título e descrição copiados para o clipboard.');
      return;
    }

    const url = await createWithGh(text, facts);
    if (!url) {
      console.log('PR não criado.');
      continue;
    }
    console.log(`✅ PR criado: ${url}`);
    if (facts.task) await notePullRequest(facts.task.id, text.title, url);
    return;
  }
}
