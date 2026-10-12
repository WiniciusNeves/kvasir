import { execSync } from 'child_process';
import { confirm } from '@utils/prompt';
import { readJson } from '@utils/fs';

interface PackageJson {
  scripts?: Record<string, string>;
}

export async function runFormat(): Promise<void> {
  const pkg = await readJson<PackageJson>('package.json');
  const formatScript = pkg?.scripts?.format;

  const command = formatScript ? 'npm run format' : 'npx prettier --write .';

  console.log(`\nThis will run: ${command}`);
  const approved = await confirm('Run formatter?');
  if (!approved) {
    console.log('Format cancelled.');
    return;
  }

  execSync(command, { stdio: 'inherit' });
  console.log('Formatting complete.');
}
