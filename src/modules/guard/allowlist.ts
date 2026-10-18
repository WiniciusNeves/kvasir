import { createHash } from 'crypto';
import { readFile, appendLine } from '@utils/fs';
import type { GuardAllowlist, GuardFinding } from '@ktypes/guard';

// .kvasirignore (project root), one entry per line, "#" for comments:
//   src/fixtures/**         path glob: files never checked
//   rule:cpf                disable a rule for this project
//   match:4111111111111111  allow this exact matched text (e.g. a public test card), written by hand
//   hash:9f2c…              allow a matched text by its SHA-256 (what kvasir writes: never the secret itself)

export const ALLOWLIST_FILE = '.kvasirignore';

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .trim()
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${escaped}$`);
}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 24);
}

export async function loadAllowlist(): Promise<GuardAllowlist> {
  const content = (await readFile(ALLOWLIST_FILE)) ?? '';
  const allowlist: GuardAllowlist = { paths: [], rules: new Set(), matches: new Set() };

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('rule:')) allowlist.rules.add(line.slice(5).trim());
    else if (line.startsWith('match:')) allowlist.matches.add(fingerprint(line.slice(6)));
    else if (line.startsWith('hash:')) allowlist.matches.add(line.slice(5).trim());
    else allowlist.paths.push(globToRegExp(line));
  }

  return allowlist;
}

export function isPathAllowed(filePath: string, allowlist: GuardAllowlist): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return allowlist.paths.some((pattern) => pattern.test(normalized));
}

export function isValueAllowed(value: string, allowlist: GuardAllowlist): boolean {
  return allowlist.matches.has(fingerprint(value));
}

export function applyAllowlist(findings: GuardFinding[], allowlist: GuardAllowlist): GuardFinding[] {
  return findings.filter(
    (finding) =>
      !isPathAllowed(finding.filePath, allowlist) &&
      !allowlist.rules.has(finding.ruleId) &&
      !isValueAllowed(finding.match, allowlist)
  );
}

// Ignored findings go to .kvasirignore so the same false positive isn't reported again. Only a hash
// is written: the file is usually committed, and writing the secret there would leak it.
export async function addToAllowlist(findings: GuardFinding[]): Promise<void> {
  for (const finding of findings) {
    const entry = finding.lineNumber === null ? finding.filePath.replace(/\\/g, '/') : `hash:${fingerprint(finding.match)}`;
    await appendLine(ALLOWLIST_FILE, `${entry}    # ${finding.ruleId} em ${finding.filePath} (kvasir guard)`);
  }
}
