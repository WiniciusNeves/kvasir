import path from 'path';
import fs from 'fs-extra';
import { readJson, listFilesRecursive } from '@utils/fs';
import { hasLocalTestRunner } from '@utils/testRunner';
import type { TestFramework } from '@utils/testRunner';

export interface TestSetup {
  framework: TestFramework;
  // "@testing-library/react-native" | "@testing-library/react" | null
  testingLibrary: string | null;
  // existing tests live in __tests__/ folders (otherwise: <name>.test.ts next to the source)
  usesTestsFolder: boolean;
  example: { file: string; content: string } | null;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const TEST_FILE = /\.(test|spec)\.(t|j)sx?$/;
const SOURCE_FILE = /\.(ts|tsx)$/;
const NOT_SOURCE = /(\.d\.ts|\.(test|spec)\.tsx?|\.config\.\w+|\.stories\.tsx?)$|(^|\/)(__tests__|__mocks__|node_modules|dist|build)\//;
const MAX_EXAMPLE_LINES = 80;

export function isTestableSource(file: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  return SOURCE_FILE.test(normalized) && !NOT_SOURCE.test(normalized);
}

async function findExistingTests(): Promise<string[]> {
  return (await listFilesRecursive('.', { extensions: ['.ts', '.tsx', '.js', '.jsx'] }))
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => TEST_FILE.test(file) || /(^|\/)__tests__\//.test(file));
}

// The existing test closest to the source (same folder, then same top folder, then any) is the style example.
function pickExample(tests: string[], sourceFile: string): string | null {
  const sourceDir = path.dirname(sourceFile.replace(/\\/g, '/'));
  const topDir = sourceDir.split('/')[0];
  return (
    tests.find((test) => path.dirname(test).startsWith(sourceDir)) ??
    tests.find((test) => test.startsWith(`${topDir}/`)) ??
    tests[0] ??
    null
  );
}

export async function detectTestSetup(sourceFile: string): Promise<TestSetup | null> {
  const pkg = await readJson<PackageJson>('package.json');
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

  const framework: TestFramework | null = deps.vitest ? 'vitest' : deps.jest || deps['jest-expo'] ? 'jest' : null;
  if (!framework) return null;

  const testingLibrary = deps['@testing-library/react-native']
    ? '@testing-library/react-native'
    : deps['@testing-library/react']
      ? '@testing-library/react'
      : null;

  const tests = await findExistingTests();
  const exampleFile = pickExample(tests, sourceFile);
  const exampleContent = exampleFile ? (await fs.readFile(exampleFile, 'utf-8')).split(/\r?\n/).slice(0, MAX_EXAMPLE_LINES).join('\n') : null;

  return {
    framework,
    testingLibrary,
    usesTestsFolder: tests.length > 0 && tests.filter((test) => test.includes('__tests__/')).length > tests.length / 2,
    example: exampleFile && exampleContent ? { file: exampleFile, content: exampleContent } : null,
  };
}

export function testFileFor(sourceFile: string, setup: TestSetup): string {
  const parsed = path.parse(sourceFile);
  const name = `${parsed.name}.test${parsed.ext}`;
  return (setup.usesTestsFolder ? path.join(parsed.dir, '__tests__', name) : path.join(parsed.dir, name)).replace(/\\/g, '/');
}

export function installHint(): string {
  return 'Nenhum framework de teste no package.json. Para começar: "npm i -D vitest" (web/Node) ou "npx expo install jest-expo jest @testing-library/react-native" (Expo).';
}

export function runnerMissingHint(framework: TestFramework): string | null {
  return hasLocalTestRunner(framework) ? null : `${framework} está no package.json mas não em node_modules. Rode "npm install".`;
}
