import { confirm, select } from '@utils/prompt';
import { readJson, pathExists } from '@utils/fs';
import { getChangedPaths } from '@utils/git';
import { runCommand, commandSucceeded } from '@utils/process';

interface PackageJson {
  scripts?: Record<string, string>;
}

type Scope = 'changed' | 'all' | 'cancel';

// "prettier --write ." over a whole project rewrote 255 files of a real one (docs included): in the middle
// of a task that buries the real change. With changes pending, the default is only the changed files.
async function chooseScope(changed: string[]): Promise<Scope> {
  if (changed.length === 0) return (await confirm('Nenhum arquivo alterado. Formatar o projeto inteiro?')) ? 'all' : 'cancel';
  return select<Scope>('O que formatar?', [
    { name: `Só os arquivos alterados (${changed.length})`, value: 'changed' },
    { name: 'O projeto inteiro', value: 'all' },
    { name: 'Cancelar', value: 'cancel' },
  ]);
}

export async function runFormat(): Promise<void> {
  const pkg = await readJson<PackageJson>('package.json');

  // The project's own "format" script decides what it formats: run it as is.
  if (pkg?.scripts?.format) {
    console.log('\nIsso vai rodar: npm run format (o script do projeto)');
    if (!(await confirm('Rodar o formatador?'))) {
      console.log('Formatação cancelada.');
      return;
    }
    runFormatter('npm', ['run', 'format']);
    return;
  }

  const changed: string[] = [];
  for (const file of getChangedPaths()) if (await pathExists(file)) changed.push(file);

  const scope = await chooseScope(changed);
  if (scope === 'cancel') {
    console.log('Formatação cancelada.');
    return;
  }

  // --ignore-unknown: a changed .png or .lock is skipped instead of failing the run
  const args = scope === 'changed' ? ['prettier', '--write', '--ignore-unknown', ...changed] : ['prettier', '--write', '.'];
  console.log(`\nIsso vai rodar: npx prettier --write ${scope === 'changed' ? `${changed.length} arquivo(s) alterado(s)` : '.'}`);
  runFormatter('npx', args);
}

function runFormatter(bin: string, args: string[]): void {
  const command = `${bin} ${args.slice(0, 3).join(' ')}`;
  const result = runCommand(bin, args, { inherit: true });
  if (!commandSucceeded(result)) {
    throw new Error(`"${command}" falhou (código ${result.status ?? '?'}). Verifique se o Prettier está instalado no projeto.`);
  }
  console.log('✅ Formatação concluída.');
}
