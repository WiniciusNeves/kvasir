import { confirm } from '@utils/prompt';
import { readJson } from '@utils/fs';
import { runCommand, commandSucceeded } from '@utils/process';

interface PackageJson {
  scripts?: Record<string, string>;
}

export async function runFormat(): Promise<void> {
  const pkg = await readJson<PackageJson>('package.json');
  const [bin, args] = pkg?.scripts?.format
    ? (['npm', ['run', 'format']] as const)
    : (['npx', ['prettier', '--write', '.']] as const);
  const command = `${bin} ${args.join(' ')}`;

  console.log(`\nIsso vai rodar: ${command}`);
  const approved = await confirm('Rodar o formatador?');
  if (!approved) {
    console.log('Formatação cancelada.');
    return;
  }

  const result = runCommand(bin, [...args], { inherit: true });
  if (!commandSucceeded(result)) {
    throw new Error(`"${command}" falhou (código ${result.status ?? '?'}). Verifique se o Prettier está instalado no projeto.`);
  }

  console.log('✅ Formatação concluída.');
}
