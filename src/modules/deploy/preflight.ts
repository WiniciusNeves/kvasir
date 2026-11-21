import { commandExists } from '@utils/process';
import { pathExists } from '@utils/fs';
import { getChangedPaths, isGitRepo } from '@utils/git';
import { checkEas } from '@modules/doctor/checks/mobile';
import { probe } from '@modules/doctor/checks/shared';
import type { CheckResult, CheckSection } from '@ktypes/doctor';
import type { DeployActionStatus, DeployTarget, EasConfig } from '@ktypes/deploy';
import { hasDependency, hasScript } from './detect';
import type { DeployPackageJson } from './detect';
import { readEasConfig, EAS_CONFIG_FILE } from './eas';

// Facts only, computed in code: what is installed, logged in and configured, and so which actions can run.

export type DeployCli = 'eas-cli' | 'vercel';

export interface DeployPreflight {
  target: DeployTarget;
  sections: CheckSection[];
  actions: DeployActionStatus[];
  eas: EasConfig | null;
  // CLIs the project needs that are not installed (the runner offers to install them)
  missingClis: DeployCli[];
}

function action(name: DeployActionStatus['action'], requirements: [boolean, string][]): DeployActionStatus {
  const missing = requirements.filter(([ok]) => !ok).map(([, what]) => what);
  return { action: name, ready: missing.length === 0, missing };
}

// EAS builds from the git tree and a web deploy from the folder: uncommitted work is a warning, not a block.
function checkWorkingTree(): CheckResult {
  if (!isGitRepo(process.cwd())) {
    return { name: 'Git', status: 'warn', detail: 'fora de um repositório git', fix: 'Sem git não dá para saber o que vai junto no deploy' };
  }
  const changed = getChangedPaths();
  return changed.length === 0
    ? { name: 'Git', status: 'ok', detail: 'nada pendente' }
    : { name: 'Git', status: 'warn', detail: `${changed.length} arquivo(s) com mudança não commitada`, fix: 'Commite antes: o deploy deve ser de um estado que está no git' };
}

async function easConfigChecks(): Promise<{ results: CheckResult[]; eas: EasConfig | null }> {
  let eas: EasConfig | null;
  try {
    eas = await readEasConfig();
  } catch (error) {
    return { results: [{ name: EAS_CONFIG_FILE, status: 'fail', detail: error instanceof Error ? error.message : String(error), fix: `Corrija o ${EAS_CONFIG_FILE}` }], eas: null };
  }
  if (!eas) return { results: [{ name: EAS_CONFIG_FILE, status: 'fail', detail: 'não existe', fix: 'eas build:configure' }], eas: null };

  const profiles = eas.buildProfiles.map((profile) => (profile.channel ? `${profile.name} (canal ${profile.channel})` : profile.name)).join(', ');
  const results: CheckResult[] = [
    eas.buildProfiles.length > 0
      ? { name: EAS_CONFIG_FILE, status: 'ok', detail: `perfis: ${profiles}` }
      : { name: EAS_CONFIG_FILE, status: 'fail', detail: 'sem perfis de build', fix: 'eas build:configure' },
  ];
  if (eas.buildProfiles.length > 0 && !eas.buildProfiles.some((profile) => profile.channel)) {
    results.push({ name: 'Canal do update', status: 'warn', detail: 'nenhum perfil tem "channel"', fix: `Adicione "channel" aos perfis de build do ${EAS_CONFIG_FILE} (o eas update publica num canal)` });
  }
  return { results, eas };
}

async function expoPreflight(pkg: DeployPackageJson | null): Promise<DeployPreflight> {
  const easInstalled = commandExists('eas');
  const easResults = checkEas();
  const loggedIn = easResults.some((result) => result.name === 'EAS login' && result.status === 'ok');
  const { results: configResults, eas } = await easConfigChecks();
  const hasUpdates = hasDependency(pkg, 'expo-updates');
  const updatesResult: CheckResult = hasUpdates
    ? { name: 'expo-updates', status: 'ok', detail: 'instalado' }
    : { name: 'expo-updates', status: 'warn', detail: 'não instalado (sem ele o app não recebe update OTA)', fix: 'npx expo install expo-updates e depois um build novo' };

  const configured = Boolean(eas && eas.buildProfiles.length > 0);
  const hasChannel = Boolean(eas?.buildProfiles.some((profile) => profile.channel));
  const base: [boolean, string][] = [
    [easInstalled, 'EAS CLI'],
    [loggedIn, 'login no EAS (eas login)'],
    [configured, EAS_CONFIG_FILE],
  ];

  return {
    target: 'expo',
    sections: [{ title: 'Deploy · Expo (EAS)', results: [...easResults, ...configResults, updatesResult, checkWorkingTree()] }],
    actions: [
      action('eas-update', [...base, [!configured || hasChannel, 'um perfil com "channel"'], [hasUpdates, 'expo-updates']]),
      action('eas-build', base),
      action('eas-submit', base),
    ],
    eas,
    missingClis: easInstalled ? [] : ['eas-cli'],
  };
}

async function webPreflight(pkg: DeployPackageJson | null): Promise<DeployPreflight> {
  const results: CheckResult[] = [];
  const canBuild = hasScript(pkg, 'build');
  results.push(
    canBuild
      ? { name: 'Build', status: 'ok', detail: `npm run build (${pkg?.scripts?.build})` }
      : { name: 'Build', status: 'warn', detail: 'sem script "build" no package.json' }
  );

  const vercelInstalled = commandExists('vercel');
  const linked = (await pathExists('.vercel/project.json')) || (await pathExists('vercel.json'));
  let loggedIn = false;
  if (!vercelInstalled) {
    // a project that never used Vercel does not need the row: the action list already says what is missing
    if (linked) results.push({ name: 'Vercel CLI', status: 'warn', detail: 'não instalado (o projeto usa a Vercel)', fix: 'npm install -g vercel' });
  } else {
    const whoami = probe('vercel', ['whoami']);
    const account = whoami.output.split('\n').map((line) => line.trim()).find((line) => line && !/vercel cli|^>|error/i.test(line));
    loggedIn = whoami.exitCode === 0 && Boolean(account);
    results.push({ name: 'Vercel CLI', status: 'ok', detail: 'instalado' });
    results.push(loggedIn ? { name: 'Vercel login', status: 'ok', detail: account ?? '' } : { name: 'Vercel login', status: 'warn', detail: 'não logado', fix: 'vercel login' });
    results.push(
      linked
        ? { name: 'Projeto na Vercel', status: 'ok', detail: 'ligado (.vercel/ ou vercel.json)' }
        : { name: 'Projeto na Vercel', status: 'warn', detail: 'ainda não ligado', fix: 'O primeiro deploy pergunta e liga o projeto (ou rode "vercel link")' }
    );
  }

  const hasDeployScript = hasScript(pkg, 'deploy');
  if (hasDeployScript) results.push({ name: 'Script deploy', status: 'ok', detail: `npm run deploy (${pkg?.scripts?.deploy})` });
  results.push(checkWorkingTree());

  return {
    target: 'web',
    sections: [{ title: 'Deploy · Web', results }],
    actions: [
      action('web-build', [[canBuild, 'script "build" no package.json']]),
      action('vercel', [
        [vercelInstalled, 'Vercel CLI'],
        [loggedIn, 'login na Vercel (vercel login)'],
      ]),
      action('npm-deploy', [[hasDeployScript, 'script "deploy" no package.json']]),
    ],
    eas: null,
    missingClis: !vercelInstalled && linked ? ['vercel'] : [],
  };
}

export async function runPreflight(target: DeployTarget, pkg: DeployPackageJson | null): Promise<DeployPreflight> {
  return target === 'expo' ? expoPreflight(pkg) : webPreflight(pkg);
}
