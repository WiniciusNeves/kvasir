import { confirm } from '@utils/prompt';
import { runCommand, commandSucceeded } from '@utils/process';
import { printCheckSection } from '@modules/doctor';
import type { DeployAction, DeployActionStatus } from '@ktypes/deploy';
import { detectDeployTarget, readDeployPackage } from './detect';
import { runPreflight } from './preflight';
import type { DeployCli, DeployPreflight } from './preflight';

const ACTION_LABELS: Record<DeployAction, string> = {
  'eas-update': 'Atualização OTA (eas update)',
  'eas-build': 'Build para as lojas (eas build: AAB/IPA)',
  'eas-submit': 'Enviar o último build para a loja (eas submit)',
  'web-build': 'Build do site (npm run build)',
  vercel: 'Deploy na Vercel (preview ou produção)',
  'npm-deploy': 'Script de deploy do projeto (npm run deploy)',
};

const CLI_LABELS: Record<DeployCli, string> = { 'eas-cli': 'o EAS CLI', vercel: 'o Vercel CLI' };

function printPreflight(preflight: DeployPreflight): void {
  preflight.sections.forEach(printCheckSection);
}

function printActions(actions: DeployActionStatus[]): void {
  console.log('\nO que dá para fazer neste projeto:');
  for (const status of actions) {
    console.log(status.ready ? `  ✅ ${ACTION_LABELS[status.action]}` : `  ⛔ ${ACTION_LABELS[status.action]} — falta: ${status.missing.join(', ')}`);
  }
}

// Installing a global CLI changes the machine: shown, asked, then run with the npm output on screen.
// Login stays with the developer (eas login / vercel login): Kvasir never handles credentials.
async function offerInstall(missing: DeployCli[]): Promise<boolean> {
  let installed = false;
  for (const cli of missing) {
    if (!(await confirm(`Instalar ${CLI_LABELS[cli]} (npm install -g ${cli})?`))) continue;
    const result = runCommand('npm', ['install', '-g', cli], { inherit: true });
    if (commandSucceeded(result)) {
      console.log(`✅ ${CLI_LABELS[cli]} instalado.`);
      installed = true;
    } else {
      console.log(`Não consegui instalar ${CLI_LABELS[cli]}. Tente "npm install -g ${cli}" no terminal.`);
    }
  }
  return installed;
}

export async function runDeploy(): Promise<void> {
  const pkg = await readDeployPackage();
  const target = detectDeployTarget(pkg);
  if (!target) {
    console.log('Não achei o que publicar aqui: preciso de um package.json com Expo, um framework web (Next, Vite…) ou os scripts "build"/"deploy".');
    return;
  }

  let preflight = await runPreflight(target, pkg);
  printPreflight(preflight);
  if (await offerInstall(preflight.missingClis)) {
    preflight = await runPreflight(target, pkg);
    printPreflight(preflight);
  }
  printActions(preflight.actions);

  // only when the CLI is there: without it, installing comes first
  const blockedByLogin = preflight.actions.some((status) => status.missing.some((item) => item.startsWith('login')) && !status.missing.some((item) => item.endsWith('CLI')));
  if (blockedByLogin) console.log(`\nO login é com você: rode "${target === 'expo' ? 'eas login' : 'vercel login'}" no terminal e depois o kvasir deploy de novo.`);
  console.log('\n(A publicação em si chega nas próximas partes do kvasir deploy: por enquanto ele só confere se o projeto está pronto.)');
}
