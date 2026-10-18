import { answerLines, cleanAnswer, truncateForPrompt } from '@ai/parse';

// Facts are computed here (deterministic); the model only writes the title text, "what changed" and
// "how to test". The final markdown is assembled by code so its structure never depends on the model.

const MAX_DIFF_CHARS = 10_000;
const MAX_TITLE = 72;

const TYPE_BY_PREFIX: Record<string, string> = {
  feature: 'feat',
  feat: 'feat',
  fix: 'fix',
  bugfix: 'fix',
  hotfix: 'fix',
  release: 'chore',
  chore: 'chore',
  refactor: 'refactor',
  docs: 'docs',
  test: 'test',
};

const UI_FILE = /\.(tsx|jsx)$/;
const UI_FOLDER = /(^|\/)(screens|components|pages|app|views|ui)\//;

export interface PrFacts {
  branch: string;
  base: string;
  type: string;
  commits: string[];
  stat: string;
  diff: string;
  hasUiChanges: boolean;
  task: { id: string; title: string } | null;
}

export interface PrDraft {
  title: string;
  changes: string[];
  testing: string[];
}

export function typeForBranch(branch: string): string {
  return TYPE_BY_PREFIX[branch.split('/')[0].toLowerCase()] ?? 'feat';
}

// Git Flow ACME: hotfix/ and release/ go to main; everything else to develop (main when there is none).
export function baseCandidates(branch: string): string[] {
  const toMain = /^(hotfix|release)\//.test(branch);
  const develop = ['develop', 'origin/develop'];
  const main = ['main', 'origin/main', 'master', 'origin/master'];
  return toMain ? [...main, ...develop] : [...develop, ...main];
}

export function hasUiChanges(files: string[]): boolean {
  return files.some((file) => UI_FILE.test(file) && UI_FOLDER.test(file.replace(/\\/g, '/')));
}

export function buildPrPrompt(facts: PrFacts): string {
  return `Você escreve descrições de Pull Request em português do Brasil para um time de desenvolvimento.

Branch: ${facts.branch} → ${facts.base}
${facts.task ? `Task: ${facts.task.id} — ${facts.task.title}\n` : ''}
Commits:
${facts.commits.map((commit) => `- ${commit}`).join('\n')}

Arquivos alterados:
${facts.stat}

Diff:
${truncateForPrompt(facts.diff, MAX_DIFF_CHARS)}

Escreva exatamente neste formato:
TITULO: ${facts.type}: <o que o PR faz, em português, no máximo 60 caracteres>
## O que mudou
- <mudança concreta, em português>
## Como testar
1. <passo que alguém do time consegue seguir>

Regras:
- Baseie-se só nos commits e no diff; não invente funcionalidades
- 2 a 6 itens em "O que mudou"; 2 a 5 passos em "Como testar"
- Sem comentários antes ou depois do formato`;
}

function sectionItems(lines: string[], heading: RegExp): string[] {
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return [];

  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s|^t[ií]tulo:/i.test(line)) break;
    const item = line.replace(/^(\d+[.)]|[-*•])\s*/, '').trim();
    if (item) items.push(item);
  }
  return items;
}

function normalizeTitle(raw: string, type: string): string {
  let title = raw.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!/^[a-z]+(\([^)]*\))?!?:\s/.test(title)) title = `${type}: ${title}`;
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1).trimEnd()}…` : title;
}

export function parsePrDraft(response: string, type: string): PrDraft {
  const clean = cleanAnswer(response);
  const lines = clean.split('\n').map((line) => line.trim());
  const titleLine = clean.match(/^\**t[ií]tulo\**:\s*(.+)$/im)?.[1] ?? answerLines(clean)[0] ?? 'atualizações';

  return {
    title: normalizeTitle(titleLine, type),
    changes: sectionItems(lines, /^#{0,6}\s*o que mudou/i),
    testing: sectionItems(lines, /^#{0,6}\s*como testar/i),
  };
}

export function buildPrBody(draft: PrDraft, facts: PrFacts): string {
  const sections = [
    '## O que mudou',
    draft.changes.length > 0 ? draft.changes.map((item) => `- ${item}`).join('\n') : '- (descreva as mudanças)',
    '',
    '## Como testar',
    draft.testing.length > 0 ? draft.testing.map((step, index) => `${index + 1}. ${step}`).join('\n') : '1. (descreva como testar)',
  ];

  if (facts.hasUiChanges) {
    sections.push('', '## Prints / vídeos', '- [ ] Antes', '- [ ] Depois');
  }

  sections.push('', '## Checklist', '- [ ] Testes passando', '- [ ] Lint sem erros', '- [ ] Tipos (tsc) sem erros');

  if (facts.task) sections.push('', '## Task', `${facts.task.id} — ${facts.task.title}`);

  sections.push('', '<details><summary>Commits</summary>', '', ...facts.commits.map((commit) => `- ${commit}`), '', '</details>');
  return sections.join('\n');
}
