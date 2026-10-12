import { readJson } from '@utils/fs';

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectProject(): Promise<'acme' | 'unknown'> {
  const pkg = await readJson<PackageJson>('package.json');
  if (pkg?.name?.includes('acme')) return 'acme';
  return 'unknown';
}

export async function detectStack(): Promise<string[]> {
  const pkg = await readJson<PackageJson>('package.json');
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const stack: string[] = [];

  if (deps.next) stack.push('Next.js');
  if (deps.expo) stack.push('React Native', 'Expo');
  if (deps.express || deps.fastify) stack.push('Node.js API');
  stack.push('TypeScript');

  return stack;
}
