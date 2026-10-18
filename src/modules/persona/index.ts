import { confirm, input, select } from '@utils/prompt';
import { slugify } from '@modules/knowledge/notes';
import {
  listPersonas,
  loadPersona,
  savePersona,
  removePersona,
  isBuiltInPersona,
  personaFileExists,
  getPersonasDir,
} from '@modules/init/personaLoader';
import type { Persona, PersonaBranchRule } from '@ktypes/persona';

type Language = 'English' | 'Português';

const EMPTY_PERSONA: Persona = {
  name: '',
  stack: ['TypeScript'],
  repoNaming: { pattern: '<name>', suffixes: [] },
  branchRules: [
    { prefix: 'feature/', description: 'New features' },
    { prefix: 'fix/', description: 'Bug fixes' },
    { prefix: 'chore/', description: 'Tooling and dependencies' },
  ],
  commitRules: {
    convention: 'Conventional Commits',
    language: 'English',
    format: '<type>(<scope>): <description>',
    types: ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'ci', 'chore', 'revert'],
  },
  language: 'English',
};

function splitList(value: string, separator: RegExp = /[,\s]+/): string[] {
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function describePersona(persona: Persona): string {
  return [
    `Persona: ${persona.name}`,
    `  Stack: ${persona.stack.join(', ') || '—'}`,
    `  Repositórios: ${persona.repoNaming.pattern}${persona.repoNaming.suffixes.length > 0 ? ` (${persona.repoNaming.suffixes.join(' ')})` : ''}`,
    `  Branches (${persona.language}):`,
    ...persona.branchRules.map((rule) => `    ${rule.prefix.padEnd(10)} ${rule.description}`),
    `  Commits: ${persona.commitRules.convention}, em ${persona.commitRules.language}, formato ${persona.commitRules.format}`,
    `  Tipos: ${persona.commitRules.types.join(', ')}`,
  ].join('\n');
}

export async function runPersonaList(): Promise<void> {
  const personas = await listPersonas();
  console.log('\nPersonas disponíveis:');
  personas.forEach((persona) => console.log(`  - ${persona.name} (${persona.source})`));
  console.log(`\nArquivos em ${getPersonasDir()}. Crie uma com "kvasir persona create".`);
}

export async function runPersonaShow(name: string): Promise<void> {
  console.log(`\n${describePersona(await loadPersona(name))}`);
}

async function askLanguage(message: string, current: string): Promise<Language> {
  const options: Language[] = current === 'Português' ? ['Português', 'English'] : ['English', 'Português'];
  return select<Language>(message, options.map((language) => ({ name: language, value: language })));
}

// Prefixes come in as "feature/ fix/ hotfix/"; descriptions are kept from the base persona when the prefix exists there.
function buildBranchRules(prefixes: string[], base: PersonaBranchRule[]): PersonaBranchRule[] {
  return prefixes.map((raw) => {
    const prefix = raw.endsWith('/') ? raw : `${raw}/`;
    return { prefix, description: base.find((rule) => rule.prefix === prefix)?.description ?? '' };
  });
}

export async function runPersonaCreate(): Promise<void> {
  const name = slugify(await input('Nome da persona (ex.: empresa-x):'));
  if (!name) throw new Error('Nome vazio.');
  if (isBuiltInPersona(name) || (await personaFileExists(name))) {
    throw new Error(`A persona "${name}" já existe. Escolha outro nome ou remova a atual.`);
  }

  const existing = await listPersonas();
  const baseName = await select<string>('Começar a partir de:', [
    ...existing.map((persona) => ({ name: `Copiar "${persona.name}"`, value: persona.name })),
    { name: 'Do zero (padrões genéricos)', value: '' },
  ]);
  const base = baseName ? await loadPersona(baseName) : EMPTY_PERSONA;

  const stack = splitList(await input('Stack (separe com vírgula):', base.stack.join(', ')), /,/);
  const prefixes = splitList(await input('Prefixos de branch:', base.branchRules.map((rule) => rule.prefix).join(' ')));
  const branchLanguage = await askLanguage('Idioma dos nomes de branch:', base.language);
  const commitLanguage = await askLanguage('Idioma das mensagens de commit:', base.commitRules.language);
  const repoPattern = (await input('Padrão de nome de repositório:', base.repoNaming.pattern)).trim();

  // The description is what the branch prompt uses to pick a prefix, so new prefixes need one.
  const branchRules = buildBranchRules(prefixes, base.branchRules);
  for (const rule of branchRules.filter((item) => !item.description)) {
    rule.description = (await input(`Para que serve "${rule.prefix}"? (ex.: correção de bug)`)).trim();
  }

  const persona: Persona = {
    name,
    stack,
    repoNaming: { pattern: repoPattern || base.repoNaming.pattern, suffixes: base.repoNaming.suffixes },
    branchRules,
    commitRules: { ...base.commitRules, language: commitLanguage },
    language: branchLanguage,
  };
  if (persona.branchRules.length === 0) throw new Error('Informe pelo menos um prefixo de branch.');

  console.log(`\n${describePersona(persona)}`);
  if (!(await confirm('Salvar esta persona?'))) {
    console.log('Persona descartada.');
    return;
  }

  await savePersona(persona);
  console.log(`✅ Persona "${name}" salva. Use em um projeto com "kvasir init".`);
}

export async function runPersonaRemove(name: string): Promise<void> {
  const exists = await personaFileExists(name);
  if (isBuiltInPersona(name)) {
    if (!exists) throw new Error(`"${name}" é uma persona embutida e não tem cópia local para remover.`);
    if (!(await confirm(`Apagar a cópia local de "${name}"? Ela volta a ser a versão embutida do Kvasir.`))) return;
    await removePersona(name);
    console.log(`✅ "${name}" voltou para a versão embutida.`);
    return;
  }

  if (!exists) throw new Error(`Persona "${name}" não encontrada.`);
  if (!(await confirm(`Remover a persona "${name}"? Projetos que a usam vão pedir outra no próximo "kvasir init".`))) return;
  await removePersona(name);
  console.log(`✅ Persona "${name}" removida.`);
}
