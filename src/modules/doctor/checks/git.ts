import { probe, firstVersion } from './shared';
import type { CheckResult } from '@ktypes/doctor';

export function checkGit(): CheckResult[] {
  const git = probe('git', ['--version']);
  if (!git.found) {
    return [{ name: 'Git', status: 'fail', detail: 'não encontrado', fix: 'Instale o Git (git-scm.com)' }];
  }

  const results: CheckResult[] = [{ name: 'Git', status: 'ok', detail: firstVersion(git.output) ?? git.output }];

  for (const key of ['user.name', 'user.email']) {
    const value = probe('git', ['config', '--get', key]).output;
    results.push(
      value
        ? { name: `git ${key}`, status: 'ok', detail: value }
        : { name: `git ${key}`, status: 'fail', detail: 'não configurado', fix: `git config --global ${key} "<seu ${key === 'user.name' ? 'nome' : 'email'}>"` }
    );
  }

  return results;
}
