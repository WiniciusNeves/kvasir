import { askFor } from '@ai/router';
import { confirm, input, select } from '@utils/prompt';
import {
  createBranch,
  getCurrentBranch,
  listLocalBranches,
  listAllBranches,
  deleteBranch,
  checkoutPreviousBranch,
} from '@utils/git';
import { loadContext } from '@modules/init/contextWriter';

type BranchChoice = 'yes' | 'no' | 'edit';
type PostBranchAction = 'none' | 'delete' | 'list' | 'previous';

function buildBranchPrompt(descricao: string): string {
  return `Gere APENAS o nome de uma branch git em inglês seguindo
Git Flow ACME. Responda somente com o nome da branch,
sem explicações, sem aspas, sem markdown.

Prefixos válidos: feature/ fix/ hotfix/ release/ chore/

Tarefa: ${descricao}

IMPORTANTE: Gere um nome baseado APENAS na tarefa descrita.
Não use exemplos genéricos.`;
}

function parseBranchName(response: string): string {
  const firstLine =
    response
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '';

  return firstLine
    .replace(/`/g, '')
    .replace(/"/g, '')
    .replace(/'/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export async function runBranch(): Promise<void> {
  await loadContext();

  const taskDescription = await input('Descreva a tarefa para esta branch:');

  const response = await askFor('branch', buildBranchPrompt(taskDescription));
  const branchName = parseBranchName(response);

  console.log(`\nBranch atual: ${getCurrentBranch()}`);
  console.log(`Branch sugerida: ${branchName}`);

  const action = await select<BranchChoice>('Usar esta branch?', [
    { name: 'Sim — criar e fazer checkout', value: 'yes' },
    { name: 'Não — cancelar', value: 'no' },
    { name: 'Editar — modificar o nome', value: 'edit' },
  ]);

  if (action === 'no') {
    console.log('❌ Criação de branch cancelada.');
    return;
  }

  let finalBranchName = branchName;

  if (action === 'edit') {
    finalBranchName = (await input('Editar o nome da branch', branchName)).trim();
  }

  if (!finalBranchName) {
    console.log('Nome de branch vazio. Criação cancelada.');
    return;
  }

  createBranch(finalBranchName);
  console.log(`✅ Branch criada: ${finalBranchName}`);

  await runPostBranchMenu();
}

export async function runDeleteBranch(): Promise<void> {
  const current = getCurrentBranch();
  const branches = listLocalBranches().filter((branch) => branch !== current);

  if (branches.length === 0) {
    console.log('Nenhuma outra branch local para deletar.');
    return;
  }

  const target = await select(
    'Qual branch deseja deletar?',
    branches.map((branch) => ({ name: branch, value: branch }))
  );

  const approved = await confirm(`Deletar a branch ${target}?`);
  if (!approved) {
    console.log('Exclusão cancelada.');
    return;
  }

  const result = deleteBranch(target);
  if (result.success) {
    console.log(`✅ Branch deletada: ${target}`);
    return;
  }

  console.log(`\n${result.stderr.trim()}`);
  const forceApproved = await confirm(`A branch "${target}" não está mergeada. Forçar exclusão (-D)?`);
  if (!forceApproved) {
    console.log('Exclusão cancelada.');
    return;
  }

  const forceResult = deleteBranch(target, true);
  if (forceResult.success) {
    console.log(`✅ Branch deletada (forçado): ${target}`);
  } else {
    console.log(`❌ Falha ao deletar a branch: ${forceResult.stderr.trim()}`);
  }
}

export async function runListBranches(): Promise<void> {
  const lines = listAllBranches()
    .split('\n')
    .map((line) => line.replace('*', '').trim())
    .filter((line) => line.length > 0);

  const local = lines.filter((line) => !line.startsWith('remotes/'));
  const remote = lines
    .filter((line) => line.startsWith('remotes/'))
    .map((line) => line.replace('remotes/', ''));

  console.log('\nBranches locais:');
  local.forEach((branch) => console.log(`  ${branch}`));

  console.log('\nBranches remotas:');
  remote.forEach((branch) => console.log(`  ${branch}`));
}

async function runPostBranchMenu(): Promise<void> {
  let keepGoing = true;

  while (keepGoing) {
    const action = await select<PostBranchAction>('O que quer fazer agora?', [
      { name: 'Nada — continuar trabalhando', value: 'none' },
      { name: 'Deletar outra branch', value: 'delete' },
      { name: 'Ver todas as branches', value: 'list' },
      { name: 'Voltar para branch anterior', value: 'previous' },
    ]);

    switch (action) {
      case 'delete':
        await runDeleteBranch();
        break;

      case 'list':
        await runListBranches();
        break;

      case 'previous':
        checkoutPreviousBranch();
        console.log(`✅ Branch atual: ${getCurrentBranch()}`);
        break;

      case 'none':
        keepGoing = false;
        break;

      default:
        break;
    }
  }
}
