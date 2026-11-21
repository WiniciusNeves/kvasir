import { readJson } from '@utils/fs';
import type { DeployTarget } from '@ktypes/deploy';

export interface DeployPackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// Frameworks whose `npm run build` produces a site to publish.
const WEB_FRAMEWORKS = ['next', 'vite', 'react-scripts', '@angular/core', 'nuxt', '@sveltejs/kit', 'astro', 'gatsby', '@remix-run/react'];

export async function readDeployPackage(): Promise<DeployPackageJson | null> {
  return readJson<DeployPackageJson>('package.json');
}

export function hasDependency(pkg: DeployPackageJson | null, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}

export function hasScript(pkg: DeployPackageJson | null, name: string): boolean {
  return Boolean(pkg?.scripts?.[name]?.trim());
}

// Expo first: an Expo app may also have a web build, but what it ships is the app.
export function detectDeployTarget(pkg: DeployPackageJson | null): DeployTarget | null {
  if (!pkg) return null;
  if (hasDependency(pkg, 'expo')) return 'expo';
  if (WEB_FRAMEWORKS.some((name) => hasDependency(pkg, name)) || hasScript(pkg, 'build') || hasScript(pkg, 'deploy')) return 'web';
  return null;
}
