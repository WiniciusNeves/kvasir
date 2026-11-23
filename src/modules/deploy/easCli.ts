import { z } from 'zod';
import { runCommand, commandSucceeded } from '@utils/process';

// Read-only questions to the EAS CLI (JSON output) and the one call that publishes, with its output on screen.
// Credentials never pass through here: the CLI uses the developer's own `eas login`.

const LIST_TIMEOUT_MS = 90_000;

const buildSchema = z.object({
  platform: z.string(),
  gitCommitHash: z.string().nullish(),
  createdAt: z.string(),
  buildProfile: z.string().nullish(),
  runtimeVersion: z.string().nullish(),
  appVersion: z.string().nullish(),
  appBuildVersion: z.string().nullish(),
  expirationDate: z.string().nullish(),
  artifacts: z.object({ buildUrl: z.string().nullish(), applicationArchiveUrl: z.string().nullish() }).nullish(),
});

const updateListSchema = z.object({
  currentPage: z.array(z.object({ message: z.string().nullish() })).default([]),
});

export interface EasBuildInfo {
  platform: string;
  commit: string | null;
  createdAt: string;
  profile: string | null;
  runtimeVersion: string | null;
}

// A finished build's file (AAB/APK/IPA) on the EAS servers, to download.
export interface EasBuildArtifact {
  platform: 'android' | 'ios';
  profile: string;
  version: string;
  createdAt: string;
  // null when EAS no longer keeps the file (artifacts expire)
  url: string | null;
  expiresAt: string | null;
}

function jsonFromEas(args: string[]): unknown {
  const result = runCommand('eas', [...args, '--json', '--non-interactive'], { timeoutMs: LIST_TIMEOUT_MS });
  if (!commandSucceeded(result)) return null;
  // the CLI may print a notice ("eas-cli@x is now available") before the JSON
  const output = result.stdout ?? '';
  const start = output.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return null;
  }
}

// The newest finished build that listens to `channel` (null when EAS has none or could not be asked).
export function lastFinishedBuild(channel: string): EasBuildInfo | null {
  const parsed = z.array(buildSchema).safeParse(jsonFromEas(['build:list', '--status', 'finished', '--channel', channel, '--limit', '1']));
  const build = parsed.success ? parsed.data[0] : undefined;
  if (!build) return null;
  return {
    platform: build.platform.toLowerCase(),
    commit: build.gitCommitHash ?? null,
    createdAt: build.createdAt,
    profile: build.buildProfile ?? null,
    runtimeVersion: build.runtimeVersion ?? build.appVersion ?? null,
  };
}

// The newest finished builds of a platform (optionally of one build profile), newest first.
export function finishedBuildArtifacts(platform: 'android' | 'ios', profile?: string, limit = 1): EasBuildArtifact[] {
  const args = ['build:list', '--status', 'finished', '--platform', platform, '--limit', String(limit), ...(profile ? ['--build-profile', profile] : [])];
  const parsed = z.array(buildSchema).safeParse(jsonFromEas(args));
  if (!parsed.success) return [];
  return parsed.data.map((build) => {
    const expired = Boolean(build.expirationDate && Date.parse(build.expirationDate) < Date.now());
    const url = build.artifacts?.buildUrl ?? build.artifacts?.applicationArchiveUrl ?? null;
    return {
      platform,
      profile: build.buildProfile ?? '?',
      version: [build.appVersion, build.appBuildVersion && `(${build.appBuildVersion})`].filter(Boolean).join(' ') || '?',
      createdAt: build.createdAt,
      url: expired ? null : url,
      expiresAt: build.expirationDate ?? null,
    };
  });
}

// The developer's last update messages on this branch: EAS lists them as '"msg" (1 month ago by user)'.
export function recentUpdateMessages(branch: string, limit = 5): string[] {
  const parsed = updateListSchema.safeParse(jsonFromEas(['update:list', '--branch', branch, '--limit', String(limit)]));
  if (!parsed.success) return [];
  return parsed.data.currentPage
    .map((update) => (update.message ?? '').replace(/\s*\([^()]*\bago\b[^()]*\)\s*$/, '').replace(/^"(.*)"$/, '$1').trim())
    .filter(Boolean);
}

// Publishing: the EAS output (progress, prompts, links) goes straight to the terminal.
export function runEas(args: string[]): boolean {
  return commandSucceeded(runCommand('eas', args, { inherit: true }));
}
