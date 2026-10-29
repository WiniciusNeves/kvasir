import { askFor } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { recordExample } from '@ai/examples';
import { noteTaskBranch } from '@modules/knowledge/auto';
import { answerLines, pickLine } from '@ai/parse';
import { confirm, input, select } from '@utils/prompt';
import {
  createBranch,
  getCurrentBranch,
  listLocalBranches,
  listAllBranches,
  deleteBranch,
  checkoutPreviousBranch,
} from '@utils/git';
import { setActiveTask } from '@modules/init/contextWriter';
import { loadContext } from '@modules/init/ensure';
import { loadPersona } from '@modules/init/personaLoader';
import type { KvasirContext } from '@ktypes/context';
import type { PersonaBranchRule } from '@ktypes/persona';

type BranchChoice = 'yes' | 'no' | 'edit';
type PostBranchAction = 'none' | 'delete' | 'list' | 'previous';

const MAX_BRANCH_SLUG = 50;

// Prefixes, their meaning and the language come from the project's persona (never hardcoded here).
interface BranchConventions {
  pattern: string;
  rules: PersonaBranchRule[];
  language: string;
}

const FALLBACK_RULES: PersonaBranchRule[] = [
  { prefix: 'feature/', description: 'New features' },
  { prefix: 'fix/', description: 'Bug fixes' },
  { prefix: 'chore/', description: 'Tooling and dependencies' },
];

async function loadConventions(context: KvasirContext): Promise<BranchConventions> {
  try {
    const persona = await loadPersona(context.project.persona);
    return { pattern: context.branchRules.pattern, rules: persona.branchRules, language: persona.language };
  } catch {
    const prefixes = context.branchRules.prefix.split(/\s+/).filter(Boolean);
    const rules = prefixes.length > 0 ? prefixes.map((prefix) => ({ prefix, description: '' })) : FALLBACK_RULES;
    return { pattern: context.branchRules.pattern || 'Git Flow', rules, language: context.branchRules.language || 'English' };
  }
}

function prefixNames(conventions: BranchConventions): string[] {
  return conventions.rules.map((rule) => rule.prefix.replace(/\/$/, '').toLowerCase());
}

function isPortuguese(language: string): boolean {
  return /portugu/i.test(language);
}

function buildBranchPrompt(descricao: string, conventions: BranchConventions): string {
  const slugRule = isPortuguese(conventions.language)
    ? 'um resumo da tarefa em PORTUGUÊS, usando as palavras da própria descrição (NÃO traduza para o inglês), sem acentos, em kebab-case. Exemplo: tarefa "incluir filtro por data no relatório" → "incluir-filtro-data-relatorio"'
    : 'um resumo da tarefa TRADUZIDO para o inglês, em kebab-case';

  return `Você cria nomes de branch git no padrão ${conventions.pattern}.

Tarefa descrita pelo desenvolvedor (pode estar em português):
${descricao}

Escolha o prefixo pelo tipo da tarefa:
${conventions.rules.map((rule) => `- ${rule.prefix.padEnd(10)} ${rule.description}`).join('\n')}

Depois do prefixo: ${slugRule} (minúsculas, palavras separadas por hífen), de 2 a 5 palavras, só letras, números e hífens.

Responda com UMA única linha: só o nome da branch (prefixo/resumo). Sem aspas, sem markdown, sem explicação.`;
}

// Normalizes whatever the model returned ("Branch: Feature/Add Login!") into a valid git branch name.
function parseBranchName(response: string, conventions: BranchConventions): string {
  const prefixes = prefixNames(conventions);
  const alternatives = prefixes.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const branchName = new RegExp(`^(${alternatives})/[a-z0-9][a-z0-9._-]*$`);
  const branchLike = new RegExp(`\\b(${alternatives})/[^\\n\`'"]+`, 'i');

  const exact = pickLine(response, branchName);
  const lines = answerLines(response);
  const embedded = lines.map((line) => line.match(branchLike)?.[0]).find((match) => match !== undefined);
  const raw = (exact ?? embedded ?? lines[0] ?? '').replace(/^[^:/]{2,40}:\s*/, '').toLowerCase();
  const [maybePrefix, ...rest] = raw.split('/');
  const hasPrefix = rest.length > 0 && prefixes.includes(maybePrefix.trim());
  const prefix = hasPrefix ? maybePrefix.trim() : prefixes[0];

  // An unknown prefix ("feature/" when the persona uses "feat/") is dropped, not glued into the slug.
  const slug = (rest.length > 0 ? rest.join('-') : raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BRANCH_SLUG)
    .replace(/-+$/, '');

  return slug ? `${prefix}/${slug}` : '';
}

export async function runBranch(): Promise<void> {
  const context = await loadContext();
  const activeTask = context.activeTask;

  const taskDescription = await input(
    activeTask ? `Descreva a tarefa (Enter usa a task ativa ${activeTask.id}):` : 'Descreva a tarefa para esta branch:',
    activeTask?.title
  );

  const conventions = await loadConventions(context);
  const about = `tarefa: ${taskDescription.trim()}`;
  const response = await askFor('branch', buildBranchPrompt(taskDescription, conventions), { temperature: 0.2, examplesFor: about });
  const branchName = parseBranchName(response, conventions);

  console.log(`\nBranch atual: ${getCurrentBranch()}`);
  console.log(`Branch sugerida: ${branchName}`);

  const action = await select<BranchChoice>('Usar esta branch?', [
    { name: 'Sim — criar e fazer checkout', value: 'yes' },
    { name: 'Não — cancelar', value: 'no' },
    { name: 'Editar — modificar o nome', value: 'edit' },
  ]);

  if (action === 'no') {
    await recordOutcome('branch', 'rejected');
    await recordExample('branch', { input: about, output: branchName, decision: 'rejected' });
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
  // "Editar" that keeps the suggested name is an approval, like the example below
  await recordOutcome('branch', finalBranchName === branchName ? 'approved' : 'rejected');
  await recordExample(
    'branch',
    finalBranchName !== branchName
      ? { input: about, output: finalBranchName, suggested: branchName, decision: 'edited' }
      : { input: about, output: branchName, decision: 'approved' }
  );

  if (activeTask && taskDescription.trim() === activeTask.title.trim()) {
    await setActiveTask({ ...activeTask, linkedBranch: finalBranchName });
    console.log(`🔗 Task ${activeTask.id} vinculada à branch ${finalBranchName}.`);
    await noteTaskBranch(activeTask.id, finalBranchName);
  }

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
  if (remote.length === 0) console.log('  (nenhuma)');
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
