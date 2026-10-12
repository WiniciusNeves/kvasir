import os from 'os';
import path from 'path';
import { readJson, writeFile, pathExists } from '@utils/fs';
import { acmePersona } from '../../personas/acme';
import type { Persona } from '@ktypes/persona';

const builtInPersonas: Record<string, Persona> = {
  acme: acmePersona,
};

export function getKvasirHome(): string {
  return path.join(os.homedir(), '.kvasir');
}

export function getPersonasDir(): string {
  return path.join(getKvasirHome(), 'personas');
}

export async function loadPersona(name: string): Promise<Persona> {
  const globalPersonaPath = path.join(getPersonasDir(), `${name}.json`);

  if (await pathExists(globalPersonaPath)) {
    const stored = await readJson<Persona>(globalPersonaPath);
    if (stored) return stored;
  }

  const builtIn = builtInPersonas[name];
  if (builtIn) {
    await savePersona(builtIn);
    return builtIn;
  }

  throw new Error(`Persona "${name}" not found`);
}

export async function savePersona(persona: Persona): Promise<void> {
  const globalPersonaPath = path.join(getPersonasDir(), `${persona.name}.json`);
  await writeFile(globalPersonaPath, JSON.stringify(persona, null, 2));
}
