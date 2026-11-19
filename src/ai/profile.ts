import os from 'os';
import path from 'path';
import { listFilesRecursive, readFile } from '@utils/fs';

// Two profiles: profile.md holds the developer's taste across projects; profiles/<project>.md holds what
// only one project showed, so the style of one project does not leak into another.

export const PREFERENCES_HEADING = '## Preferências aprendidas';

export function globalProfilePath(): string {
  return path.join(os.homedir(), '.kvasir', 'profile.md');
}

function projectProfilesDir(): string {
  return path.join(os.homedir(), '.kvasir', 'profiles');
}

export function projectProfilePath(project: string): string {
  const safe = project.replace(/[^\w.-]+/g, '_') || 'projeto';
  return path.join(projectProfilesDir(), `${safe}.md`);
}

export function preferencesSection(profile: string): string {
  const section = profile.replace(/\r\n/g, '\n').match(/## Preferências aprendidas\n([\s\S]*?)(?=\n## |$)/);
  return section?.[1].trim() ?? '';
}

export async function readPreferences(project: string): Promise<{ global: string; project: string }> {
  const [global, own] = await Promise.all([readFile(globalProfilePath()), readFile(projectProfilePath(project))]);
  return { global: preferencesSection(global ?? ''), project: preferencesSection(own ?? '') };
}

// The learned preferences of every project that has some, by project (file) name.
export async function readProjectPreferences(): Promise<{ project: string; preferences: string }[]> {
  const files = await listFilesRecursive(projectProfilesDir(), { extensions: ['.md'] });
  const profiles = await Promise.all(
    files.map(async (file) => ({ project: path.basename(file, '.md'), preferences: preferencesSection((await readFile(path.join(projectProfilesDir(), file))) ?? '') }))
  );
  return profiles.filter((profile) => profile.preferences);
}

// The same profile with its learned-preferences section replaced by `items` (created when missing). The
// other sections ("## Stack pessoal", anything written by hand) stay as they are.
export function withPreferences(profile: string, items: string[]): string {
  const body = items.map((item) => `- ${item}`).join('\n');
  const text = profile.replace(/\r\n/g, '\n').trimEnd();
  // the heading may be the last line, with nothing after it (a new project profile)
  const section = /## Preferências aprendidas[^\n]*(?:\n[\s\S]*?)?(?=\n## |$)/;
  const next = section.test(text) ? text.replace(section, () => `${PREFERENCES_HEADING}\n\n${body}\n`) : `${text}\n\n${PREFERENCES_HEADING}\n\n${body}\n`;
  return `${next.trimEnd()}\n`;
}
