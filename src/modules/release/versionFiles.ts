import { readFile, writeFile, pathExists } from '@utils/fs';

// Version bumps in package.json, package-lock.json and app.json (Expo), keeping each file's
// indentation and final newline so the release commit only shows the version lines.

export interface VersionFileChange {
  file: string;
  description: string;
}

type JsonObject = Record<string, unknown>;

function detectIndent(raw: string): string | number {
  const match = raw.match(/^[ \t]+(?=")/m);
  return match ? match[0] : 2;
}

async function updateJson(file: string, mutate: (json: JsonObject) => string | null): Promise<VersionFileChange | null> {
  const raw = await readFile(file);
  if (raw === null) return null;

  const json = JSON.parse(raw) as JsonObject;
  const description = mutate(json);
  if (!description) return null;

  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(json, null, detectIndent(raw)).replace(/\n/g, eol);
  await writeFile(file, raw.endsWith('\n') ? `${text}${eol}` : text);
  return { file, description };
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

export async function readPackageVersion(): Promise<string | null> {
  const raw = await readFile('package.json');
  if (raw === null) return null;
  const version = (JSON.parse(raw) as JsonObject).version;
  return typeof version === 'string' ? version : null;
}

export async function applyVersion(version: string): Promise<VersionFileChange[]> {
  const changes: (VersionFileChange | null)[] = [];

  changes.push(
    await updateJson('package.json', (json) => {
      const previous = json.version;
      json.version = version;
      return `version ${String(previous ?? '—')} → ${version}`;
    })
  );

  changes.push(
    await updateJson('package-lock.json', (json) => {
      json.version = version;
      const root = asObject(asObject(json.packages)?.['']);
      if (root) root.version = version;
      return `version → ${version}`;
    })
  );

  // Expo: expo.version plus the store build numbers, which must grow on every store release.
  changes.push(
    await updateJson('app.json', (json) => {
      const expo = asObject(json.expo);
      if (!expo) return null;
      const notes = [`expo.version → ${version}`];
      expo.version = version;

      const android = asObject(expo.android);
      if (android && typeof android.versionCode === 'number') {
        android.versionCode += 1;
        notes.push(`android.versionCode → ${android.versionCode}`);
      }

      const ios = asObject(expo.ios);
      if (ios && typeof ios.buildNumber === 'string' && /^\d+$/.test(ios.buildNumber)) {
        ios.buildNumber = String(Number(ios.buildNumber) + 1);
        notes.push(`ios.buildNumber → ${ios.buildNumber}`);
      }
      return notes.join(', ');
    })
  );

  return changes.filter((change): change is VersionFileChange => change !== null);
}

// app.config.js/ts is code: it can't be edited safely, only flagged.
export async function findDynamicExpoConfig(): Promise<string | null> {
  for (const file of ['app.config.ts', 'app.config.js']) {
    if (await pathExists(file)) return file;
  }
  return null;
}
