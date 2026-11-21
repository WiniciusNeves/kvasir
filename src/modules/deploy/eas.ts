import { z } from 'zod';
import { readFile } from '@utils/fs';
import type { EasBuildProfile, EasConfig } from '@ktypes/deploy';

export const EAS_CONFIG_FILE = 'eas.json';

// Only what `kvasir deploy` reads; the rest of eas.json is EAS's business.
const buildProfileSchema = z.object({
  extends: z.string().optional(),
  channel: z.string().optional(),
  distribution: z.string().optional(),
});

const easSchema = z.object({
  build: z.record(z.string(), buildProfileSchema).optional(),
  submit: z.record(z.string(), z.unknown()).optional(),
});

type RawBuildProfile = z.infer<typeof buildProfileSchema>;

// A profile without its own channel or distribution takes the one of the profile it extends.
function resolveProfile(name: string, profiles: Record<string, RawBuildProfile>, seen: string[] = []): EasBuildProfile {
  const profile = profiles[name] ?? {};
  const parent = profile.extends && !seen.includes(profile.extends) ? resolveProfile(profile.extends, profiles, [...seen, name]) : null;
  return { name, channel: profile.channel ?? parent?.channel, distribution: profile.distribution ?? parent?.distribution };
}

// null when the project has no eas.json; throws when it exists but is not valid JSON / not the expected shape.
export async function readEasConfig(): Promise<EasConfig | null> {
  const raw = await readFile(EAS_CONFIG_FILE);
  if (raw === null) return null;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${EAS_CONFIG_FILE} não é um JSON válido.`);
  }
  const parsed = easSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${EAS_CONFIG_FILE} tem um formato inesperado: ${parsed.error.issues[0]?.message ?? 'erro desconhecido'}.`);

  const builds = parsed.data.build ?? {};
  return {
    buildProfiles: Object.keys(builds).map((name) => resolveProfile(name, builds)),
    submitProfiles: Object.keys(parsed.data.submit ?? {}),
  };
}
