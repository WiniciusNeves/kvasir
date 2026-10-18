import { confirm } from '@utils/prompt';
import { runCommand, commandSucceeded } from '@utils/process';
import { readProjectPackage } from './checks/shared';
import { checkNode } from './checks/node';
import { checkGit } from './checks/git';
import { checkMobile, isMobileProject } from './checks/mobile';
import { checkOllama } from './checks/ollama';
import { checkKvasir, checkGithubCli } from './checks/kvasir';
import type { CheckResult, CheckSection, CheckStatus } from '@ktypes/doctor';

const ICONS: Record<CheckStatus, string> = { ok: '✅', warn: '⚠️ ', fail: '❌' };

function printSection(section: CheckSection): void {
  console.log(`\n${section.title}`);
  const width = Math.max(...section.results.map((result) => result.name.length));
  for (const result of section.results) {
    console.log(`  ${ICONS[result.status]} ${result.name.padEnd(width)}  ${result.detail}`);
    if (result.status !== 'ok' && result.fix) console.log(`     ${' '.repeat(width)}  → ${result.fix}`);
  }
}

// Deterministic: no AI in the main flow (Doc/ideas/novos-modulos.md §5).
async function offerModelDownload(missing: string[]): Promise<void> {
  if (missing.length === 0) return;

  const approved = await confirm(`Baixar os modelos que faltam (${missing.join(', ')})? Cada um tem alguns GB.`);
  if (!approved) return;

  for (const model of missing) {
    console.log(`\n⬇️  ollama pull ${model}`);
    const result = runCommand('ollama', ['pull', model], { inherit: true });
    console.log(commandSucceeded(result) ? `✅ ${model} instalado.` : `❌ Falha ao baixar ${model}.`);
  }
}

export async function runDoctor(): Promise<void> {
  console.log('🩺 kvasir doctor: verificando o ambiente...');

  const pkg = await readProjectPackage();
  const ollama = await checkOllama();

  const sections: CheckSection[] = [
    { title: 'Node e gerenciadores', results: checkNode(pkg) },
    { title: 'Git', results: checkGit() },
    ...(isMobileProject(pkg) ? [{ title: 'Mobile (React Native / Expo)', results: checkMobile(pkg) }] : []),
    { title: 'IA local (Ollama)', results: ollama.results },
    { title: 'Kvasir', results: await checkKvasir() },
    { title: 'GitHub', results: checkGithubCli() },
  ];

  sections.forEach(printSection);

  const all: CheckResult[] = sections.flatMap((section) => section.results);
  const failures = all.filter((result) => result.status === 'fail').length;
  const warnings = all.filter((result) => result.status === 'warn').length;

  console.log(
    `\n${failures === 0 && warnings === 0 ? '✅ Tudo certo.' : `Resumo: ${all.length - failures - warnings} ok · ${warnings} aviso(s) · ${failures} problema(s).`}`
  );
  if (!isMobileProject(pkg) && pkg) console.log('(checagens de mobile puladas: o projeto não usa expo nem react-native)');

  await offerModelDownload(ollama.missing);
}
