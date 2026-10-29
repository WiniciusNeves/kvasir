import { askLocal } from '@ai/router';
import { recordOutcome } from '@ai/metrics';
import { checkbox, confirm, select } from '@utils/prompt';
import { readFile, writeFile, pathExists, removeFile } from '@utils/fs';
import { getChangedPaths } from '@utils/git';
import { runTestFile } from '@utils/testRunner';
import { noteBugFoundByTest } from '@modules/knowledge/auto';
import { relatedContext } from '@modules/omnicontext/context';
import { listExports, importedDefinitions } from '@utils/imports';
import { detectTestSetup, testFileFor, isTestableSource, installHint, runnerMissingHint, relatedTestCandidates } from './framework';
import type { TestSetup } from './framework';
import { buildGeneratePrompt, buildFixPrompt, parseTestAnswer } from './prompt';
import type { TestTarget } from './prompt';

// Validation is objective here: the test runner, not a second model. Generation and fixes use the
// local "Testador" (qwen2.5-coder) and the developer approves the file before it is written.
const MAX_ATTEMPTS = 3;
const AI_OPTIONS = { temperature: 0.2, timeoutMs: 180_000 };
const OUTPUT_TAIL_LINES = 25;
const MAX_EXISTING_CALLS = 6;

type ExistingAction = 'overwrite' | 'skip';
type GiveUpAction = 'keep' | 'delete';

function tail(output: string, lines: number): string {
  return output.split('\n').slice(-lines).join('\n');
}

async function chooseFiles(target: string | undefined): Promise<string[]> {
  if (target) {
    if (!(await pathExists(target))) throw new Error(`Arquivo não encontrado: ${target}`);
    return [target.replace(/\\/g, '/')];
  }

  const changed = getChangedPaths().filter(isTestableSource);
  if (changed.length === 0) {
    console.log('Nenhum arquivo .ts/.tsx alterado (sem contar testes). Use "kvasir test <arquivo>".');
    return [];
  }
  if (changed.length === 1) return changed;

  return checkbox<string>('Gerar testes para quais arquivos?', changed.map((file) => ({ name: file, value: file })));
}

async function giveUp(testFile: string): Promise<void> {
  const action = await select<GiveUpAction>(`O teste ainda falha depois de ${MAX_ATTEMPTS} tentativas. O que fazer com ${testFile}?`, [
    { name: 'Manter o arquivo para eu ajustar', value: 'keep' },
    { name: 'Apagar o arquivo', value: 'delete' },
  ]);
  if (action === 'delete') {
    await removeFile(testFile);
    console.log(`🗑️  ${testFile} apagado.`);
  }
}

// How the project's own tests already call a helper ("expect(isValidCPF('529.982.247-25')).toBe(true)"):
// real, proven values, since a local model can't compute a check digit by itself.
async function existingCalls(file: string, name: string): Promise<string[]> {
  for (const candidate of await relatedTestCandidates(file)) {
    const content = await readFile(candidate);
    if (content === null) continue;
    return content
      .split(/\r?\n/)
      .filter((line) => line.includes(`${name}(`) && !/^\s*(describe|it|test)\(/.test(line))
      .map((line) => line.trim())
      .slice(0, MAX_EXISTING_CALLS);
  }
  return [];
}

// The project functions the file under test calls, read from their files (a fact, always available).
async function importedHelpers(target: TestTarget): Promise<string> {
  const definitions = importedDefinitions(target.sourceFile, target.source);
  if (definitions.length === 0) return '';
  const blocks: string[] = [];
  for (const definition of definitions) {
    const calls = await existingCalls(definition.file, definition.name);
    const proven = calls.length > 0 ? `\n// valores já testados no projeto:\n${calls.map((call) => `// ${call}`).join('\n')}` : '';
    blocks.push(`// ${definition.file}\n${definition.code}${proven}`);
  }
  return `Funções do projeto que o arquivo testado usa (a implementação real; os dados do teste têm que passar nelas, prefira os valores já testados):\n\`\`\`ts\n${blocks.join('\n\n')}\n\`\`\`\n`;
}

// Related code the file under test uses (types, helpers from other files), for both prompts.
async function testContext(target: TestTarget): Promise<string> {
  const imports = target.source
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  const related = await relatedContext(`${target.sourceFile}\n${listExports(target.source).join(' ')}\n${imports}`, {
    excludeFiles: [target.sourceFile, target.testFile],
    limit: 3,
  });
  return [await importedHelpers(target), related].filter(Boolean).join('\n');
}

async function generateAndRun(target: TestTarget, setup: TestSetup): Promise<void> {
  const projectContext = await testContext(target);
  console.log(`\n🧪 Gerando teste para ${target.sourceFile} (${setup.framework}${setup.example ? `, estilo de ${setup.example.file}` : ''})...`);
  const first = parseTestAnswer(await askLocal('test', buildGeneratePrompt(target, setup, projectContext), AI_OPTIONS));
  if (!first.code) {
    console.log('⚠️  A IA não devolveu um arquivo de teste. Tente de novo.');
    await recordOutcome('test', 'rejected');
    return;
  }

  console.log(`\n${'─'.repeat(60)}\n${first.code}${'─'.repeat(60)}`);
  const approved = await confirm(`Salvar em ${target.testFile} e rodar? (se falhar, a IA corrige sozinha até ${MAX_ATTEMPTS} vezes)`);
  if (!approved) {
    await recordOutcome('test', 'rejected');
    console.log('Teste descartado.');
    return;
  }

  let code = first.code;
  await writeFile(target.testFile, code);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`\n▶️  Rodando ${target.testFile} (tentativa ${attempt}/${MAX_ATTEMPTS})...`);
    const run = runTestFile(setup.framework, target.testFile);

    if (run.passed) {
      console.log(`✅ Passou: ${target.testFile}`);
      await recordOutcome('test', 'approved');
      return;
    }

    console.log(`❌ Falhou:\n${tail(run.output, OUTPUT_TAIL_LINES)}`);
    if (attempt === MAX_ATTEMPTS) break;

    console.log('🔧 Pedindo a correção à IA...');
    const fixed = parseTestAnswer(await askLocal('test', buildFixPrompt(target, setup, code, run.output, projectContext), AI_OPTIONS));

    // A real bug: keep the failing test as evidence instead of bending it to pass.
    if (fixed.bug) {
      console.log(`\n🐞 A IA acha que o teste encontrou um bug no código: ${fixed.bug}`);
      if (fixed.code) await writeFile(target.testFile, fixed.code);
      await noteBugFoundByTest(target.sourceFile, fixed.bug);
      console.log(`O teste fica em ${target.testFile} falhando até o código ser corrigido (dá para usar "kvasir fix").`);
      await recordOutcome('test', 'approved');
      return;
    }

    if (!fixed.code) {
      console.log('⚠️  A IA não devolveu uma correção.');
      break;
    }
    code = fixed.code;
    await writeFile(target.testFile, code);
  }

  await recordOutcome('test', 'rejected');
  await giveUp(target.testFile);
}

export async function runTest(target?: string): Promise<void> {
  const files = await chooseFiles(target);

  for (const sourceFile of files) {
    const setup = await detectTestSetup(sourceFile);
    if (!setup) {
      console.log(installHint());
      return;
    }

    const missing = runnerMissingHint(setup.framework);
    if (missing) throw new Error(missing);

    const testFile = testFileFor(sourceFile, setup);
    if (await pathExists(testFile)) {
      const action = await select<ExistingAction>(`${testFile} já existe.`, [
        { name: 'Pular este arquivo', value: 'skip' },
        { name: 'Substituir por um teste novo', value: 'overwrite' },
      ]);
      if (action === 'skip') continue;
    }

    const source = await readFile(sourceFile);
    if (source === null) continue;
    await generateAndRun({ sourceFile, testFile, source }, setup);
  }
}
