import path from 'path';
import { detectProject, detectStack } from './detector';
import { loadPersona, listPersonas, getKvasirHome } from './personaLoader';
import { writeContext, readContext } from './contextWriter';
import { readJson } from '@utils/fs';
import { confirm, select } from '@utils/prompt';
import { writeClaude } from '@adapters/claude';
import { writeCopilot } from '@adapters/copilot';
import { writeCursor } from '@adapters/cursor';
import type { KvasirContext, ActiveTaskInfo } from '@ktypes/context';

interface PackageJson {
  name?: string;
}

const NO_PERSONA = '__none__';
const ACTIVE_MODULES = ['branch', 'commit', 'guard', 'fix', 'review', 'test', 'pr', 'daily', 'release', 'doc', 'task', 'knowledge', 'doctor'];

// The detected persona (ACME when the package name contains "acme") comes first; any other can be picked.
async function choosePersona(detected: 'acme' | 'unknown'): Promise<string | null> {
  const personas = await listPersonas();
  const ordered = [...personas].sort((a, b) => (a.name === detected ? -1 : b.name === detected ? 1 : a.name.localeCompare(b.name)));

  const choice = await select<string>(detected === 'acme' ? 'Persona (detectada: acme):' : 'Qual persona este projeto segue?', [
    ...ordered.map((persona) => ({ name: `${persona.name} (${persona.source})`, value: persona.name })),
    { name: 'Nenhuma por enquanto', value: NO_PERSONA },
  ]);
  return choice === NO_PERSONA ? null : choice;
}

// Re-running init must not lose the active task.
async function readExistingTask(): Promise<ActiveTaskInfo | null> {
  try {
    return (await readContext()).activeTask;
  } catch {
    return null;
  }
}

export async function runInit(): Promise<void> {
  const pkg = await readJson<PackageJson>('package.json');
  const projectName = pkg?.name ?? path.basename(process.cwd());

  const projectType = await detectProject();
  const stack = await detectStack();

  console.log(`\nProjeto: ${projectName}`);
  console.log(`Tipo: ${projectType === 'acme' ? 'ACME' : 'não identificado'}`);
  console.log(`Stack: ${stack.join(', ') || 'não identificada'}`);

  const personaName = await choosePersona(projectType);
  if (!personaName) {
    console.log('Sem persona por enquanto. Rode "kvasir init" de novo quando quiser escolher uma (veja "kvasir persona list").');
    return;
  }

  const persona = await loadPersona(personaName);

  const context: KvasirContext = {
    project: {
      name: projectName,
      type: projectType === 'acme' ? 'ACME' : 'unknown',
      stack,
      persona: persona.name,
    },
    developer: {
      profile: path.join(getKvasirHome(), 'profile.md'),
    },
    branchRules: {
      pattern: persona.name === 'acme' ? 'Git Flow ACME' : 'Git Flow',
      prefix: persona.branchRules.map((rule) => rule.prefix).join(' '),
      language: persona.language,
    },
    commitRules: {
      convention: persona.commitRules.convention,
      language: persona.commitRules.language,
      format: persona.commitRules.format,
    },
    activeModules: ACTIVE_MODULES,
    activeTask: await readExistingTask(),
    summary: `${projectName} (${projectType}) — stack: ${stack.join(', ')}`,
  };

  console.log('\nIsso vai escrever o kvasir.context.md e gerar as instruções para as IAs (CLAUDE.md, Copilot, Cursor).');
  const approved = await confirm('Continuar?');
  if (!approved) {
    console.log('Init cancelado.');
    return;
  }

  await writeContext(context);
  await writeClaude();
  await writeCopilot();
  await writeCursor();

  console.log(`\n✅ Kvasir configurado com a persona "${persona.name}".`);
}
