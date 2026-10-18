import type { AiCallRecord, AiOutcomeRecord, AiProvider, MetricsRecord } from '@ai/metrics';

// Performance-based routing (backlog block 6: "escolha automática por desempenho"). Deterministic,
// from ~/.kvasir/metrics only:
// 1. Cooldown: a candidate whose last calls all failed recently goes to the end of the chain
//    (e.g. Gemini answering 503 for a while) instead of costing a timeout on every command.
// 2. Candidates with enough data are reordered by measured quality: approval by the user ×
//    success rate (both smoothed). Candidates without enough data keep their default slot, so a
//    model nobody has tried yet is not pushed up or down by a guess.

export interface RankableCandidate {
  provider: AiProvider;
  model: string;
}

export interface CandidateStats {
  calls: number;
  failures: number;
  approved: number;
  rejected: number;
  avgSeconds: number | null;
  coolingDown: boolean;
  // null = not enough data: keeps its default position
  score: number | null;
}

export interface RankedCandidate<T extends RankableCandidate> {
  candidate: T;
  stats: CandidateStats;
  reason: string;
}

export const PERFORMANCE_WINDOW_DAYS = 30;
const MIN_CALLS = 5;
const MIN_VERDICTS = 3;
const COOLDOWN_FAILURES = 3;
const COOLDOWN_MINUTES = 15;

function statsFor(task: string, candidate: RankableCandidate, records: MetricsRecord[], now: number): CandidateStats {
  const calls = records.filter(
    (record): record is AiCallRecord =>
      record.type === 'call' && record.role === 'executor' && record.task === task && record.provider === candidate.provider && record.model === candidate.model
  );
  const ok = calls.filter((call) => call.ok);
  const verdicts = records.filter(
    (record): record is AiOutcomeRecord => record.type === 'outcome' && record.task === task && record.model === candidate.model
  );
  const approved = verdicts.filter((verdict) => verdict.decision === 'approved').length;
  const rejected = verdicts.length - approved;

  const recent = calls.slice(-COOLDOWN_FAILURES);
  const lastAt = recent.length > 0 ? Date.parse(recent[recent.length - 1].timestamp) : 0;
  const coolingDown =
    recent.length === COOLDOWN_FAILURES && recent.every((call) => !call.ok) && now - lastAt < COOLDOWN_MINUTES * 60 * 1000;

  // Laplace smoothing: 1 approval out of 1 is not "100%".
  const reliability = (ok.length + 1) / (calls.length + 2);
  const approval = (approved + 1) / (verdicts.length + 2);
  const enoughData = verdicts.length >= MIN_VERDICTS || calls.length >= MIN_CALLS;

  return {
    calls: calls.length,
    failures: calls.length - ok.length,
    approved,
    rejected,
    avgSeconds: ok.length > 0 ? ok.reduce((sum, call) => sum + call.durationMs, 0) / ok.length / 1000 : null,
    coolingDown,
    score: enoughData ? approval * reliability : null,
  };
}

function describe(stats: CandidateStats): string {
  if (stats.coolingDown) return `em pausa: ${COOLDOWN_FAILURES} falhas seguidas nos últimos ${COOLDOWN_MINUTES} min`;
  if (stats.score === null) return stats.calls === 0 ? 'ordem padrão (sem uso ainda)' : `ordem padrão (poucos dados: ${stats.calls} chamada(s))`;
  const verdicts = stats.approved + stats.rejected;
  const approval = verdicts > 0 ? `aprovação ${Math.round((stats.approved / verdicts) * 100)}% (${stats.approved}/${verdicts})` : 'sem avaliações';
  const success = `${stats.calls - stats.failures}/${stats.calls} ok`;
  const time = stats.avgSeconds !== null ? `, ${stats.avgSeconds.toFixed(1)}s` : '';
  return `${approval}, ${success}${time}`;
}

export function rankCandidates<T extends RankableCandidate>(
  task: string,
  candidates: T[],
  records: MetricsRecord[],
  now: number = Date.now()
): RankedCandidate<T>[] {
  const ranked = candidates.map((candidate) => {
    const stats = statsFor(task, candidate, records, now);
    return { candidate, stats, reason: describe(stats) };
  });

  // Slot-preserving sort: only the candidates with a score trade places among themselves.
  const scoredSlots = ranked.map((item, index) => (item.stats.score !== null ? index : -1)).filter((index) => index >= 0);
  const scored = scoredSlots
    .map((index) => ranked[index])
    .sort((a, b) => {
      const diff = (b.stats.score ?? 0) - (a.stats.score ?? 0);
      if (Math.abs(diff) > 0.05) return diff;
      return (a.stats.avgSeconds ?? Infinity) - (b.stats.avgSeconds ?? Infinity);
    });
  const reordered = [...ranked];
  scoredSlots.forEach((slot, position) => {
    reordered[slot] = scored[position];
  });

  // Cooling-down candidates last (still tried if everything else fails).
  return [...reordered.filter((item) => !item.stats.coolingDown), ...reordered.filter((item) => item.stats.coolingDown)];
}
