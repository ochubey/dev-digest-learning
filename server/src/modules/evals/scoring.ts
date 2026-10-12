import type { EvalExpectation, EvalFindingMatch, EvalRunCounts, EvalRunMetrics } from '@devdigest/shared';
import { matches, type Located } from './matching.js';

/** What scoring needs from one case result; `EvalCaseResult` satisfies it. */
export interface ScorableResult {
  status: 'pending' | 'ok' | 'error';
  expectation: EvalExpectation;
  grounded: ReadonlyArray<Located>;
  dropped: ReadonlyArray<unknown>;
}

export interface CaseScore {
  pass: boolean;
  matchedCount: number;
  labels: EvalFindingMatch[];
}

/** AC-25 and the per-finding labels used by AC-27. Only this case's findings are passed in (AC-30). */
export function scoreCase(expectation: EvalExpectation, grounded: ReadonlyArray<Located>): CaseScore {
  const labels = grounded.map((f): EvalFindingMatch => {
    if (!matches(f, expectation)) return 'unlabeled';
    return expectation.kind === 'must_find' ? 'tp' : 'fp_zone';
  });
  const matchedCount = labels.filter((l) => l !== 'unlabeled').length;
  const pass = expectation.kind === 'must_find' ? matchedCount >= 1 : matchedCount === 0;
  return { pass, matchedCount, labels };
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

/** AC-26..AC-28, derived only from the stored counts (AC-29). */
export function metricsFromCounts(c: EvalRunCounts): EvalRunMetrics {
  return {
    recall: ratio(c.must_find_hit, c.must_find_total),
    precision: ratio(c.tp, c.tp + c.fp_zone + c.fp_unlabeled),
    citation_accuracy: ratio(c.grounded, c.grounded + c.dropped),
  };
}

/** Scores a whole run. `error` (and unfinished `pending`) results are excluded from every count. */
export function scoreRun(results: ReadonlyArray<ScorableResult>): { metrics: EvalRunMetrics; counts: EvalRunCounts } {
  const counts: EvalRunCounts = {
    cases_scored: 0,
    cases_passed: 0,
    must_find_total: 0,
    must_find_hit: 0,
    must_not_flag_total: 0,
    must_not_flag_violated: 0,
    tp: 0,
    fp_zone: 0,
    fp_unlabeled: 0,
    grounded: 0,
    dropped: 0,
    cases_errored: 0,
  };
  for (const r of results) {
    if (r.status === 'error') {
      counts.cases_errored++;
      continue;
    }
    if (r.status !== 'ok') continue;
    const s = scoreCase(r.expectation, r.grounded);
    counts.cases_scored++;
    if (s.pass) counts.cases_passed++;
    if (r.expectation.kind === 'must_find') {
      counts.must_find_total++;
      if (s.matchedCount >= 1) counts.must_find_hit++;
    } else {
      counts.must_not_flag_total++;
      if (s.matchedCount >= 1) counts.must_not_flag_violated++;
    }
    for (const l of s.labels) {
      if (l === 'tp') counts.tp++;
      else if (l === 'fp_zone') counts.fp_zone++;
      else counts.fp_unlabeled++;
    }
    counts.grounded += r.grounded.length;
    counts.dropped += r.dropped.length;
  }
  return { metrics: metricsFromCounts(counts), counts };
}
