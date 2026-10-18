import type { ParsedCommit } from './semver';

// CHANGELOG.md, newest version first, grouped by type. Deterministic: built from the commits only.

const CHANGELOG_TITLE = '# Changelog';

const GROUPS: { title: string; matches: (commit: ParsedCommit) => boolean }[] = [
  { title: '⚠️ Mudanças incompatíveis', matches: (commit) => commit.breaking },
  { title: 'Novidades', matches: (commit) => commit.type === 'feat' },
  { title: 'Correções', matches: (commit) => commit.type === 'fix' },
  { title: 'Desempenho', matches: (commit) => commit.type === 'perf' },
  { title: 'Outras mudanças', matches: (commit) => ['refactor', 'docs', 'test', 'build', 'ci', 'style', 'revert', 'other'].includes(commit.type) },
];

// chore(release) commits are the release itself; chore in general is noise for a changelog.
function isRelevant(commit: ParsedCommit): boolean {
  return commit.type !== 'chore' || commit.breaking;
}

function formatItem(commit: ParsedCommit): string {
  return `- ${commit.scope ? `**${commit.scope}:** ` : ''}${commit.description} (${commit.hash})`;
}

export function buildChangelogSection(version: string, date: string, commits: ParsedCommit[]): string {
  const relevant = commits.filter(isRelevant);
  const used = new Set<ParsedCommit>();
  const parts = [`## ${version} (${date})`];

  for (const group of GROUPS) {
    const items = relevant.filter((commit) => !used.has(commit) && group.matches(commit));
    if (items.length === 0) continue;
    items.forEach((commit) => used.add(commit));
    parts.push('', `### ${group.title}`, '', ...items.map(formatItem));
  }

  if (used.size === 0) parts.push('', '- Manutenção interna (sem mudanças visíveis).');
  return parts.join('\n');
}

// Inserts the new section right after the "# Changelog" title (creates the file content if needed).
export function prependChangelog(existing: string | null, section: string): string {
  if (!existing || !existing.trim()) return `${CHANGELOG_TITLE}\n\n${section}\n`;

  const normalized = existing.replace(/\r\n/g, '\n');
  const titleMatch = normalized.match(/^# .*\n+/);
  if (!titleMatch) return `${CHANGELOG_TITLE}\n\n${section}\n\n${normalized.trimStart()}`;

  return `${titleMatch[0].trimEnd()}\n\n${section}\n\n${normalized.slice(titleMatch[0].length).trimStart()}`.trimEnd() + '\n';
}
