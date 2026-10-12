import path from 'path';
import { detectProject, detectStack } from './detector';
import { loadPersona, getKvasirHome } from './personaLoader';
import { writeContext } from './contextWriter';
import { readJson } from '@utils/fs';
import { confirm, select } from '@utils/prompt';
import { writeClaude } from '@adapters/claude';
import { writeCopilot } from '@adapters/copilot';
import { writeCursor } from '@adapters/cursor';
import type { KvasirContext } from '@ktypes/context';

interface PackageJson {
  name?: string;
}

export async function runInit(): Promise<void> {
  const pkg = await readJson<PackageJson>('package.json');
  const projectName = pkg?.name ?? path.basename(process.cwd());

  const projectType = await detectProject();
  const stack = await detectStack();

  console.log(`\nDetected project: ${projectName}`);
  console.log(`Detected type: ${projectType}`);
  console.log(`Detected stack: ${stack.join(', ') || 'unknown'}`);

  const personaName = 'acme';
  if (projectType === 'unknown') {
    const choice = await select('No persona detected. What would you like to do?', [
      { name: 'Use the built-in ACME persona', value: 'acme' },
      { name: 'Skip persona for now', value: 'none' },
    ]);
    if (choice === 'none') {
      console.log('Skipping persona setup.');
      return;
    }
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
      pattern: 'Git Flow ACME',
      prefix: persona.branchRules.map((rule) => rule.prefix).join(' '),
      language: persona.language,
    },
    commitRules: {
      convention: persona.commitRules.convention,
      language: persona.commitRules.language,
      format: persona.commitRules.format,
    },
    activeModules: ['branch', 'commit', 'fix', 'format', 'doc', 'task'],
    activeTask: null,
    summary: `${projectName} (${projectType}) — stack: ${stack.join(', ')}`,
  };

  console.log('\nThis will write kvasir.context.md and generate AI-specific instruction files.');
  const approved = await confirm('Proceed with init?');
  if (!approved) {
    console.log('Init cancelled.');
    return;
  }

  await writeContext(context);
  await writeClaude();
  await writeCopilot();
  await writeCursor();

  console.log('\nKvasir initialized successfully.');
}
