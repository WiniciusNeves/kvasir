import os from 'os';
import path from 'path';
import { pathExists } from '@utils/fs';
import { probe } from './shared';
import type { CheckResult } from '@ktypes/doctor';

export async function checkKvasir(): Promise<CheckResult[]> {
  const home = path.join(os.homedir(), '.kvasir');
  const results: CheckResult[] = [];

  results.push(
    (await pathExists(home))
      ? { name: '~/.kvasir', status: 'ok', detail: home }
      : { name: '~/.kvasir', status: 'warn', detail: 'ainda não existe', fix: 'Rode "kvasir init" em um projeto' }
  );

  results.push(
    (await pathExists('kvasir.context.md'))
      ? { name: 'kvasir.context.md', status: 'ok', detail: 'presente neste projeto' }
      : { name: 'kvasir.context.md', status: 'warn', detail: 'não encontrado nesta pasta', fix: 'Rode "kvasir init" na raiz do projeto' }
  );

  const profile = path.join(home, 'profile.md');
  results.push(
    (await pathExists(profile))
      ? { name: 'profile.md', status: 'ok', detail: 'preferências aprendidas disponíveis para os prompts' }
      : { name: 'profile.md', status: 'warn', detail: 'ainda não existe', fix: 'Use commit/fix/review e depois rode "kvasir learn"' }
  );

  const code = probe('code', ['--version']);
  results.push(
    code.found
      ? { name: 'VS Code (code)', status: 'ok', detail: code.output.split('\n')[0] }
      : { name: 'VS Code (code)', status: 'warn', detail: 'comando "code" não está no PATH (o fix usa para abrir o diff)', fix: 'No VS Code: Ctrl+Shift+P → "Shell Command: Install \'code\' command in PATH"' }
  );

  return results;
}

export function checkGithubCli(): CheckResult[] {
  const gh = probe('gh', ['--version']);
  if (!gh.found) {
    return [{ name: 'GitHub CLI (gh)', status: 'warn', detail: 'não instalado (o "kvasir pr" usa para criar o PR)', fix: 'winget install GitHub.cli (ou cli.github.com) e depois "gh auth login"' }];
  }

  const auth = probe('gh', ['auth', 'status']);
  return [
    { name: 'GitHub CLI (gh)', status: 'ok', detail: gh.output.split('\n')[0] },
    auth.exitCode === 0
      ? { name: 'gh login', status: 'ok', detail: 'autenticado' }
      : { name: 'gh login', status: 'warn', detail: 'não autenticado', fix: 'gh auth login' },
  ];
}
