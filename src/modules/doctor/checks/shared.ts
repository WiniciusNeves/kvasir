import { runCommand, commandExists } from '@utils/process';
import { readJson } from '@utils/fs';

const PROBE_TIMEOUT_MS = 15_000;

export interface ProbeResult {
  found: boolean;
  output: string;
  exitCode: number | null;
}

// Runs a tool with a short timeout and returns stdout+stderr (java prints its version to stderr).
export function probe(bin: string, args: string[]): ProbeResult {
  // Existence comes from `where`/`which` (commandExists), never from the localized error message.
  if (!commandExists(bin)) return { found: false, output: '', exitCode: null };

  const result = runCommand(bin, args, { timeoutMs: PROBE_TIMEOUT_MS });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { found: !result.error && result.status !== null, output, exitCode: result.status };
}

export function firstVersion(text: string): string | null {
  return text.match(/(\d+)\.(\d+)(?:\.(\d+))?/)?.[0] ?? null;
}

export function majorOf(version: string): number {
  return parseInt(version.replace(/^v/, '').split('.')[0], 10);
}

export interface ProjectPackageJson {
  name?: string;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readProjectPackage(): Promise<ProjectPackageJson | null> {
  return readJson<ProjectPackageJson>('package.json');
}

export function hasDependency(pkg: ProjectPackageJson | null, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}
