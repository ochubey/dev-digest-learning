import { describe, it, expect } from 'vitest';
import type { EvalExpectation } from '@devdigest/shared';
import { matches } from '../src/modules/evals/matching.js';
import { scoreCase, scoreRun, metricsFromCounts } from '../src/modules/evals/scoring.js';

const exp = (kind: EvalExpectation['kind'], start = 10, end = 12, file = 'src/a.ts'): EvalExpectation => ({
  kind,
  file,
  start_line: start,
  end_line: end,
});
const f = (start: number, end: number, file = 'src/a.ts') => ({ file, start_line: start, end_line: end });
const ok = (expectation: EvalExpectation, grounded: ReturnType<typeof f>[], dropped = 0) => ({
  status: 'ok' as const,
  expectation,
  grounded,
  dropped: Array.from({ length: dropped }, () => ({})),
});

describe('eval scoring', () => {
  it('match table: 10–12 vs 12–15 match; 10–11 vs 12–15 no; reversed range matches; other file no; ./src/a.ts == src/a.ts; src/A.ts != src/a.ts', () => {
    expect(matches(f(10, 12), exp('must_find', 12, 15))).toBe(true);
    expect(matches(f(10, 11), exp('must_find', 12, 15))).toBe(false);
    expect(matches(f(14, 11), exp('must_find', 12, 15))).toBe(true);
    expect(matches(f(10, 12, 'src/b.ts'), exp('must_find', 10, 12))).toBe(false);
    expect(matches(f(10, 12, './src/a.ts'), exp('must_find', 10, 12))).toBe(true);
    expect(matches(f(10, 12), exp('must_find', 10, 12, './src/a.ts'))).toBe(true);
    expect(matches(f(10, 12, 'src/A.ts'), exp('must_find', 10, 12))).toBe(false);
  });

  it('must_find pass with 1 and 2 matches, fail with 0; must_not_flag inverse', () => {
    const mf = exp('must_find');
    expect(scoreCase(mf, []).pass).toBe(false);
    expect(scoreCase(mf, [f(10, 10)]).pass).toBe(true);
    expect(scoreCase(mf, [f(10, 10), f(11, 11)])).toMatchObject({ pass: true, matchedCount: 2 });
    const mn = exp('must_not_flag');
    expect(scoreCase(mn, []).pass).toBe(true);
    expect(scoreCase(mn, [f(50, 51)]).pass).toBe(true);
    expect(scoreCase(mn, [f(10, 10)]).pass).toBe(false);
    expect(scoreCase(mn, [f(10, 10), f(11, 11)])).toMatchObject({ pass: false, matchedCount: 2 });
  });

  it('recall 3/4 = 0.75; double match counts once; zero must_find -> null', () => {
    const results = [
      ok(exp('must_find'), [f(10, 10), f(11, 11)]),
      ok(exp('must_find'), [f(10, 10)]),
      ok(exp('must_find'), [f(12, 12)]),
      ok(exp('must_find'), []),
    ];
    const { metrics, counts } = scoreRun(results);
    expect(metrics.recall).toBe(0.75);
    expect(counts.must_find_total).toBe(4);
    expect(counts.must_find_hit).toBe(3);
    expect(scoreRun([ok(exp('must_not_flag'), [])]).metrics.recall).toBeNull();
  });

  it('precision fixture A{match,match,unlabeled} B{zone,unlabeled} -> TP2 FPz1 FPu2 = 0.4; no grounded -> null', () => {
    const a = ok(exp('must_find'), [f(10, 10), f(11, 11), f(40, 41)]);
    const b = ok(exp('must_not_flag'), [f(10, 10), f(40, 41)]);
    const { metrics, counts } = scoreRun([a, b]);
    expect(counts).toMatchObject({ tp: 2, fp_zone: 1, fp_unlabeled: 2, grounded: 5 });
    expect(metrics.precision).toBe(0.4);
    expect(scoreCase(exp('must_find'), [f(10, 10), f(40, 41)]).labels).toEqual(['tp', 'unlabeled']);
    expect(scoreCase(exp('must_not_flag'), [f(10, 10)]).labels).toEqual(['fp_zone']);
    expect(scoreRun([ok(exp('must_find'), [])]).metrics.precision).toBeNull();
  });

  it('citation 6 kept 2 dropped -> 0.75; 0/0 -> null', () => {
    const r = scoreRun([
      ok(exp('must_find'), [f(10, 10), f(11, 11), f(12, 12)], 1),
      ok(exp('must_find'), [f(10, 10), f(11, 11), f(12, 12)], 1),
    ]);
    expect(r.metrics.citation_accuracy).toBe(0.75);
    expect(r.counts).toMatchObject({ grounded: 6, dropped: 2 });
    expect(scoreRun([ok(exp('must_find'), [])]).metrics.citation_accuracy).toBeNull();
  });

  it('error results excluded from every count', () => {
    const err = { status: 'error' as const, expectation: exp('must_find'), grounded: [f(10, 10)], dropped: [{}] };
    const { metrics, counts } = scoreRun([err, ok(exp('must_find'), [f(10, 10)])]);
    expect(counts).toMatchObject({
      cases_scored: 1,
      cases_passed: 1,
      must_find_total: 1,
      must_find_hit: 1,
      tp: 1,
      grounded: 1,
      dropped: 0,
      cases_errored: 1,
    });
    expect(metrics).toEqual({ recall: 1, precision: 1, citation_accuracy: 1 });
    expect(scoreRun([err]).counts.cases_scored).toBe(0);
  });

  it('metrics recomputable from counts', () => {
    const run = scoreRun([
      ok(exp('must_find'), [f(10, 10), f(40, 41)], 1),
      ok(exp('must_find'), []),
      ok(exp('must_not_flag'), [f(10, 10)], 2),
    ]);
    expect(metricsFromCounts(run.counts)).toEqual(run.metrics);
    expect(run.counts).toMatchObject({ must_not_flag_total: 1, must_not_flag_violated: 1, cases_passed: 1 });
  });

  it('case B on same file/overlap not hit by case A findings', () => {
    const a = ok(exp('must_find', 10, 12), [f(10, 12)]);
    const b = ok(exp('must_find', 10, 12), []);
    const { counts } = scoreRun([a, b]);
    expect(counts.must_find_hit).toBe(1);
    expect(counts.cases_passed).toBe(1);
  });

  it('scoring is a pure function of plain data: inputs are not mutated and repeated calls agree (AC-23; import purity is in eval-scoring-purity.test.ts)', () => {
    const results = [ok(exp('must_find'), [f(10, 10)], 1), ok(exp('must_not_flag'), [f(50, 50)])];
    const frozen = structuredClone(results);
    const deepFreeze = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        Object.values(o).forEach(deepFreeze);
      }
    };
    deepFreeze(results);
    const first = scoreRun(results);
    expect(scoreRun(results)).toEqual(first);
    expect(results).toEqual(frozen);
    expect(scoreCase(exp('must_find'), [f(10, 10)])).toEqual(scoreCase(exp('must_find'), [f(10, 10)]));
  });
});
