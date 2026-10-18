import { collectStats } from './data';
import { renderStatsHtml } from './html';
import { writeReport, openReport } from './report';

export interface StatsOptions {
  days?: string;
  // commander --no-open
  open?: boolean;
  watch?: boolean;
}

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const WATCH_SECONDS = 3;
const REPORT_FILE = 'stats.html';

function parseDays(value: string | undefined): number {
  if (value === undefined) return DEFAULT_DAYS;
  const days = Number.parseInt(value, 10);
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) throw new Error(`--days precisa ser um número entre 1 e ${MAX_DAYS}.`);
  return days;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generate(days: number, options: { refreshSeconds?: number; focusBoard?: boolean }): Promise<string> {
  const data = await collectStats(days);
  return writeReport(REPORT_FILE, renderStatsHtml(data, options));
}

// Stats + Agent Board as an offline HTML page in ~/.kvasir/reports/stats.html.
export async function runStats(options: StatsOptions = {}): Promise<void> {
  const days = parseDays(options.days);
  const watch = options.watch ?? false;
  const filePath = await generate(days, watch ? { refreshSeconds: WATCH_SECONDS, focusBoard: true } : {});

  console.log(`📊 Relatório gerado: ${filePath}`);
  if (options.open !== false) openReport(filePath);
  if (!watch) return;

  // The page reloads itself; this loop keeps the file fresh while the agents work in other terminals.
  console.log(`👀 Agent Board ao vivo: atualizando a cada ${WATCH_SECONDS}s. Ctrl+C para parar.`);
  for (;;) {
    await wait(WATCH_SECONDS * 1000);
    await generate(days, { refreshSeconds: WATCH_SECONDS, focusBoard: true });
  }
}

export async function runBoard(options: StatsOptions = {}): Promise<void> {
  await runStats({ ...options, watch: true });
}
