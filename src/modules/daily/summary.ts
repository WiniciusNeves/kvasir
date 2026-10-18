import path from 'path';
import { answerLines } from '@ai/parse';
import type { AuthoredCommit } from '@utils/git';

const MAX_ITEMS = 6;
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export interface DailyPeriod {
  // passed to git log --since
  gitSince: string;
  // shown to the user ("desde ontem (16/10)")
  label: string;
}

export interface RepoCommits {
  repo: string;
  commits: AuthoredCommit[];
}

export interface DailyMessage {
  date: Date;
  yesterday: string[];
  today: string[];
  blockers: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

// Monday (and the weekend) look back to Friday; any other day, to yesterday. From 00:00 local time.
export function computePeriod(now: Date, override?: string): DailyPeriod {
  if (override) return { gitSince: override, label: `desde ${override}` };

  const day = now.getDay();
  const daysBack = day === 1 ? 3 : day === 0 ? 2 : 1;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  const label = daysBack === 1 ? `desde ontem (${shortDate(start)})` : `desde sexta (${shortDate(start)})`;

  return { gitSince: `${isoDate(start)} 00:00`, label };
}

export function buildYesterdayPrompt(repos: RepoCommits[], period: DailyPeriod): string {
  const listing = repos
    .filter((entry) => entry.commits.length > 0)
    .map((entry) => `[${path.basename(entry.repo)}]\n${entry.commits.map((commit) => `- ${commit.subject}`).join('\n')}`)
    .join('\n\n');

  return `Commits de um desenvolvedor ${period.label}, por repositório:

${listing}

Escreva a parte "Ontem" de uma daily (reunião rápida do time), em português do Brasil:
- 2 a ${MAX_ITEMS} itens curtos; junte commits do mesmo assunto num item só
- linguagem que o time entende: o que foi feito, não como (sem hash, sem "feat:"/"fix:", sem nomes de arquivo)
- se houver mais de um repositório, comece o item com o nome do projeto entre colchetes
- traduza o sentido, não palavra por palavra (ex.: "cart" = carrinho de compras, "fix crash" = corrigi o travamento)
- escreva na primeira pessoa do passado ("Criei", "Corrigi", "Adicionei")
- não invente nada que não esteja nos commits

Exemplo de formato (outros commits):
- [loja-app] Corrigi o travamento ao abrir o carrinho vazio
- [loja-api] Criei o endpoint de pagamento com Pix e os testes dele

Responda só com a lista, um item por linha começando com "- ".`;
}

function stripConventionalPrefix(subject: string): string {
  return subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '');
}

// Bullets from the model; if it answered something unusable, fall back to the commit subjects.
export function parseYesterday(response: string, repos: RepoCommits[]): string[] {
  const items = answerLines(response)
    .map((line) => line.replace(/^(\d+[.)]|[-*•])\s*/, '').replace(/^(\[[^\]]+\])\s*[-–:]\s*/, '$1 ').trim())
    .filter((line) => line.length > 3 && !/^(ontem|aqui|segue)\b/i.test(line));

  const unique = Array.from(new Set(items)).slice(0, MAX_ITEMS);
  if (unique.length > 0) return unique;

  return repos.flatMap((entry) => entry.commits.map((commit) => stripConventionalPrefix(commit.subject))).slice(0, MAX_ITEMS);
}

export function splitItems(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map((item) => item.replace(/^(\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}

export function buildDailyMessage(message: DailyMessage): string {
  const list = (items: string[]): string => (items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- Nenhum');

  return [
    `**Daily · ${WEEKDAYS[message.date.getDay()]} ${shortDate(message.date)}**`,
    '',
    '**Ontem**',
    list(message.yesterday),
    '',
    '**Hoje**',
    list(message.today),
    '',
    '**Impedimentos**',
    list(message.blockers),
  ].join('\n');
}
