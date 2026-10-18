import os from 'os';
import path from 'path';
import fs from 'fs-extra';
import { z } from 'zod';
import { readJson, writeFile, pathExists, removeFile } from '@utils/fs';
import { acmePersona } from '../../personas/acme';
import type { Persona } from '@ktypes/persona';

const builtInPersonas: Record<string, Persona> = {
  acme: acmePersona,
};

// Custom personas are JSON files people edit by hand: validate instead of trusting them.
const personaSchema = z.object({
  name: z.string().min(1),
  stack: z.array(z.string()),
  repoNaming: z.object({ pattern: z.string(), suffixes: z.array(z.string()) }),
  branchRules: z.array(z.object({ prefix: z.string().min(1), description: z.string() })).min(1),
  commitRules: z.object({ convention: z.string(), language: z.string(), format: z.string(), types: z.array(z.string()) }),
  language: z.string(),
});

export type PersonaSource = 'embutida' | 'personalizada' | 'embutida, personalizada';

export interface PersonaListItem {
  name: string;
  source: PersonaSource;
}

export function getKvasirHome(): string {
  return path.join(os.homedir(), '.kvasir');
}

export function getPersonasDir(): string {
  return path.join(getKvasirHome(), 'personas');
}

function personaPath(name: string): string {
  return path.join(getPersonasDir(), `${name}.json`);
}

export function isBuiltInPersona(name: string): boolean {
  return name in builtInPersonas;
}

export async function loadPersona(name: string): Promise<Persona> {
  if (await pathExists(personaPath(name))) {
    const stored = await readJson<unknown>(personaPath(name));
    const parsed = personaSchema.safeParse(stored);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`Persona "${name}" inválida em ${personaPath(name)}: ${issue.path.join('.')} ${issue.message}`);
    }
    return parsed.data;
  }

  const builtIn = builtInPersonas[name];
  if (builtIn) {
    await savePersona(builtIn);
    return builtIn;
  }

  throw new Error(`Persona "${name}" não encontrada. Veja as disponíveis com "kvasir persona list".`);
}

export async function savePersona(persona: Persona): Promise<void> {
  await writeFile(personaPath(persona.name), `${JSON.stringify(persona, null, 2)}\n`);
}

export async function listPersonas(): Promise<PersonaListItem[]> {
  const dir = getPersonasDir();
  const files = (await fs.pathExists(dir)) ? (await fs.readdir(dir)).filter((file) => file.endsWith('.json')) : [];
  const saved = new Set(files.map((file) => file.replace(/\.json$/, '')));
  const names = Array.from(new Set([...Object.keys(builtInPersonas), ...saved])).sort();

  return names.map((name) => {
    if (!isBuiltInPersona(name)) return { name, source: 'personalizada' as const };
    // The built-in is saved to disk on first use; it only counts as customized if it differs.
    const customized = saved.has(name) && JSON.stringify(fs.readJsonSync(personaPath(name), { throws: false })) !== JSON.stringify(builtInPersonas[name]);
    return { name, source: customized ? ('embutida, personalizada' as const) : ('embutida' as const) };
  });
}

// For a built-in persona this only drops the local copy (it comes back as the built-in next time).
export async function removePersona(name: string): Promise<void> {
  await removeFile(personaPath(name));
}

export async function personaFileExists(name: string): Promise<boolean> {
  return pathExists(personaPath(name));
}
