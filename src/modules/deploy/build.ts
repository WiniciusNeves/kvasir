import fs from 'fs';
import path from 'path';
import { confirm, select } from '@utils/prompt';
import { downloadFile, downloadsDir } from '@utils/download';
import { currentProject } from '@utils/project';
import { noteDeploy } from '@modules/knowledge/auto';
import type { EasConfig } from '@ktypes/deploy';
import { finishedBuildArtifacts, runEas } from './easCli';
import type { EasBuildArtifact } from './easCli';

// eas build, the build's file and eas submit: no AI, only choices read from eas.json and EAS, the exact
// command and a confirmation. The EAS output goes straight to the terminal (progress, link, its prompts).

type Platform = 'android' | 'ios' | 'all';
type AfterBuild = 'download' | 'submit' | 'nothing';

const PLATFORM_CHOICES: { name: string; value: Platform }[] = [
  { name: 'Android (AAB)', value: 'android' },
  { name: 'iOS (IPA)', value: 'ios' },
  { name: 'Os dois', value: 'all' },
];

const FILE_PLATFORM_CHOICES: { name: string; value: 'android' | 'ios' }[] = [
  { name: 'Android', value: 'android' },
  { name: 'iOS', value: 'ios' },
];

const BUILDS_TO_LIST = 8;

function showCommand(args: string[]): void {
  console.log(`\nComando: eas ${args.join(' ')}`);
}

function platformsOf(platform: Platform): ('android' | 'ios')[] {
  return platform === 'all' ? ['android', 'ios'] : [platform];
}

// Store profiles first: development/internal builds are rarely what "deploy" means.
async function pickBuildProfile(eas: EasConfig): Promise<string> {
  const ordered = [...eas.buildProfiles].sort((a, b) => Number(a.distribution === 'internal') - Number(b.distribution === 'internal'));
  return select(
    'Qual perfil de build?',
    ordered.map((profile) => ({
      name: [profile.name, profile.channel && `canal ${profile.channel}`, profile.distribution === 'internal' && 'interno'].filter(Boolean).join(' · '),
      value: profile.name,
    }))
  );
}

function artifactFileName(artifact: EasBuildArtifact & { url: string }): string {
  const extension = path.extname(new URL(artifact.url).pathname) || (artifact.platform === 'ios' ? '.ipa' : '.aab');
  const version = artifact.version.replace(/[()]/g, '').trim().replace(/\s+/g, '-');
  return `${currentProject()}-${artifact.profile}-${version}${extension}`.replace(/[^\w.-]/g, '_');
}

function describeArtifact(artifact: EasBuildArtifact): string {
  const day = artifact.createdAt.slice(0, 10);
  return `${artifact.platform} · ${artifact.profile} · ${artifact.version} · ${day}${artifact.url ? '' : ' · arquivo expirado'}`;
}

// The file goes to the Downloads folder: the developer uploads it to the store by hand.
async function downloadArtifact(artifact: EasBuildArtifact): Promise<boolean> {
  if (!artifact.url) {
    console.log(`O arquivo desse build (${describeArtifact(artifact)}) não está mais no EAS: os arquivos expiram.`);
    return false;
  }
  const destination = path.join(downloadsDir(), artifactFileName({ ...artifact, url: artifact.url }));
  if (fs.existsSync(destination)) {
    console.log(`✅ Já estava baixado: ${destination}`);
    return true;
  }
  console.log(`Baixando ${describeArtifact(artifact)}...`);
  try {
    await downloadFile(artifact.url, destination);
  } catch (error) {
    console.log(`Não consegui baixar: ${error instanceof Error ? error.message : String(error)}. O link fica na página do build no expo.dev.`);
    return false;
  }
  console.log(`✅ Salvo em ${destination}`);
  return true;
}

// Picks one of the latest finished builds of a platform and downloads its file.
export async function runEasDownload(): Promise<void> {
  const platform = await select('Arquivo de qual plataforma?', FILE_PLATFORM_CHOICES);
  console.log('\nConsultando os builds no EAS...');
  const builds = finishedBuildArtifacts(platform, undefined, BUILDS_TO_LIST);
  if (builds.length === 0) {
    console.log(`Não achei build ${platform} terminado no EAS.`);
    return;
  }
  const index = await select(
    'Qual build?',
    builds.map((build, position) => ({ name: describeArtifact(build), value: String(position) }))
  );
  await downloadArtifact(builds[Number(index)]);
}

export async function runEasSubmit(eas: EasConfig, platform?: Platform, buildProfile?: string): Promise<void> {
  const target = platform ?? (await select<Platform>('Enviar para qual loja?', PLATFORM_CHOICES));
  const submitProfile =
    buildProfile && eas.submitProfiles.includes(buildProfile)
      ? buildProfile
      : eas.submitProfiles.length > 1
        ? await select('Qual perfil de envio (submit no eas.json)?', eas.submitProfiles.map((name) => ({ name, value: name })))
        : eas.submitProfiles[0];
  const args = ['submit', '--platform', target, '--latest', ...(submitProfile ? ['--profile', submitProfile] : [])];

  showCommand(args);
  console.log('Envia o último build dessa plataforma para a Play Console / App Store Connect.');
  if (!(await confirm('Enviar para a loja?'))) {
    console.log('Nada foi enviado.');
    return;
  }
  if (!runEas(args)) {
    console.log('O eas submit falhou (a saída do EAS está acima).');
    return;
  }
  console.log('✅ Build enviado para a loja.');
  await noteDeploy('eas submit', `${target}${submitProfile ? ` (${submitProfile})` : ''}`, 'último build enviado para a loja');
}

// After a build: download the file (the usual way: the developer uploads it to the store), or eas submit
// when the project has a submit profile.
async function afterBuild(eas: EasConfig, platform: Platform, profileName: string): Promise<void> {
  const choice = await select<AfterBuild>('E agora?', [
    { name: 'Baixar o arquivo (vai para a pasta Downloads)', value: 'download' },
    ...(eas.submitProfiles.length > 0 ? [{ name: 'Enviar para a loja (eas submit)', value: 'submit' as const }] : []),
    { name: 'Nada', value: 'nothing' },
  ]);
  if (choice === 'submit') {
    await runEasSubmit(eas, platform, profileName);
    return;
  }
  if (choice !== 'download') return;
  for (const target of platformsOf(platform)) {
    const [artifact] = finishedBuildArtifacts(target, profileName, 1);
    if (artifact) await downloadArtifact(artifact);
    else console.log(`Não achei o build ${target} terminado no EAS.`);
  }
}

export async function runEasBuild(eas: EasConfig): Promise<void> {
  const platform = await select<Platform>('Build para qual plataforma?', PLATFORM_CHOICES);
  const profileName = await pickBuildProfile(eas);
  const profile = eas.buildProfiles.find((item) => item.name === profileName);
  const args = ['build', '--platform', platform, '--profile', profileName];

  showCommand(args);
  console.log('O build roda nos servidores do EAS e pode levar de 10 a 30 minutos (conta na cota do seu plano).');
  if (!(await confirm('Começar o build?'))) {
    console.log('Nenhum build foi iniciado.');
    return;
  }
  if (!runEas(args)) {
    console.log('O eas build falhou (a saída do EAS está acima).');
    return;
  }
  console.log('✅ Build terminado.');
  await noteDeploy('eas build', `${platform} · ${profileName}`, profile?.channel ? `canal ${profile.channel}` : 'build sem canal de update');
  await afterBuild(eas, platform, profileName);
}
