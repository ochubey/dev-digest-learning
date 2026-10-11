import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EvalExpectation, EvalSuiteRunDetail, EvalCaseMeta } from '@devdigest/shared';
import {
  SEED_EVAL_CASES,
  SEED_EVAL_PROMPT_V2_SUFFIX,
  SEED_EVAL_RUNS,
  SEED_EVAL_RUN_V1_ID,
  SEED_EVAL_RUN_V2_ID,
} from '../src/db/fixtures/eval-cases.js';
import { inspectFragment } from '../src/modules/evals/fragment.js';
import { scoreCase, scoreRun } from '../src/modules/evals/scoring.js';
import { validateCaseInput } from '../src/modules/evals/validate.js';
import { EVAL_CASE_NAME_MAX } from '../src/modules/evals/constants.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';

const byKey = (key: string) => SEED_EVAL_CASES.find((c) => c.seed_key === key)!;

describe('seeded eval cases', () => {
  it('has at least 8 cases, at least 3 per kind, with unique keys and names', () => {
    expect(SEED_EVAL_CASES.length).toBeGreaterThanOrEqual(8);
    expect(SEED_EVAL_CASES.filter((c) => c.expectation.kind === 'must_find').length).toBeGreaterThanOrEqual(3);
    expect(SEED_EVAL_CASES.filter((c) => c.expectation.kind === 'must_not_flag').length).toBeGreaterThanOrEqual(3);
    expect(new Set(SEED_EVAL_CASES.map((c) => c.seed_key)).size).toBe(SEED_EVAL_CASES.length);
    expect(new Set(SEED_EVAL_CASES.map((c) => c.name)).size).toBe(SEED_EVAL_CASES.length);
    for (const c of SEED_EVAL_CASES) {
      expect(c.name.length, c.seed_key).toBeLessThanOrEqual(EVAL_CASE_NAME_MAX);
      expect(c.seed_key, c.seed_key).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every fragment parses, holds its file, and its range intersects a hunk (passes the AC-14 validator)', () => {
    for (const c of SEED_EVAL_CASES) {
      const e = EvalExpectation.parse(c.expectation);
      expect(inspectFragment(c.input_diff, e.file, e.start_line, e.end_line), c.seed_key).toBe('ok');
      expect(validateCaseInput({ name: c.name, expectation: e, input_diff: c.input_diff }), c.seed_key).toEqual([]);
    }
  });

  it('each fragment is one file, hunk headers match their bodies, and the range touches an added line', () => {
    for (const c of SEED_EVAL_CASES) {
      const files = parseUnifiedDiff(c.input_diff).files;
      expect(files.map((f) => f.path), c.seed_key).toEqual([c.expectation.file]);
      const lines = c.input_diff.split('\n');
      const head = lines.findIndex((l) => l.startsWith('@@'));
      const m = lines[head]!.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/)!;
      const body = lines.slice(head + 1).filter((l, i, a) => !(i === a.length - 1 && l === ''));
      expect(body.filter((l) => l[0] !== '+').length, `${c.seed_key} old`).toBe(Number(m[2]));
      expect(body.filter((l) => l[0] !== '-').length, `${c.seed_key} new`).toBe(Number(m[4]));
      let n = Number(m[3]);
      const added: number[] = [];
      for (const l of body) {
        if (l[0] === '-') continue;
        if (l[0] === '+') added.push(n);
        n++;
      }
      const { start_line: s, end_line: e } = c.expectation;
      expect(added.some((x) => x >= s && x <= e), `${c.seed_key} range touches an added line`).toBe(true);
    }
  });

  it('keeps fragments neutral: no comment lines are added', () => {
    for (const c of SEED_EVAL_CASES) {
      const added = c.input_diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      for (const l of added) expect(l, c.seed_key).not.toMatch(/\/\/|\/\*|^\+\s*#/);
    }
  });

  it('derived cases carry their origin and link to the seeded findings; the others are "seeded"', () => {
    const derived = SEED_EVAL_CASES.filter((c) => c.derived_from);
    expect(derived.map((c) => c.seed_key).sort()).toEqual(['hardcoded-stripe-key', 'n-plus-one-user-list']);
    expect(byKey('hardcoded-stripe-key').origin).toBe('accepted_finding');
    expect(byKey('n-plus-one-user-list').origin).toBe('dismissed_finding');
    // Same file and lines as the seeded demo findings (seed.ts): config.ts:12 and users.ts:45-52.
    expect(byKey('hardcoded-stripe-key').expectation).toMatchObject({ file: 'src/config.ts', start_line: 12, end_line: 12 });
    expect(byKey('n-plus-one-user-list').expectation).toMatchObject({ file: 'src/api/users.ts', start_line: 45, end_line: 52 });
    for (const c of SEED_EVAL_CASES) if (!c.derived_from) expect(c.origin, c.seed_key).toBe('seeded');
  });

  it('the stored meta shape parses', () => {
    for (const c of SEED_EVAL_CASES) {
      expect(EvalCaseMeta.safeParse({ origin: c.origin, seed_key: c.seed_key }).success).toBe(true);
    }
  });
});

describe('seeded eval runs', () => {
  const detailOf = (r: (typeof SEED_EVAL_RUNS)[number]) => ({
    id: r.id,
    agent_id: '00000000-0000-4000-8000-000000000000',
    agent_name: 'Security Reviewer',
    agent_version: r.agent_version,
    status: r.status,
    error: null,
    cases_total: r.results.length,
    cases_done: r.results.length,
    metrics: r.metrics,
    counts: r.counts,
    duration_ms: r.duration_ms,
    cost_usd: r.cost_usd,
    started_at: r.started_at,
    finished_at: r.finished_at,
    manifest: {
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      system_prompt: 'p',
      output_schema: null,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: [],
      skill_versions: [],
    },
    results: r.results.map(({ seed_key: _k, ...rest }) => rest),
  });

  it('are two finished runs at v1 and v2 with the fixed ids', () => {
    expect(SEED_EVAL_RUNS.map((r) => [r.id, r.agent_version])).toEqual([
      [SEED_EVAL_RUN_V1_ID, 1],
      [SEED_EVAL_RUN_V2_ID, 2],
    ]);
    expect(SEED_EVAL_PROMPT_V2_SUFFIX.trim().length).toBeGreaterThan(0);
    expect(new Date(SEED_EVAL_RUNS[0]!.started_at) < new Date(SEED_EVAL_RUNS[1]!.started_at)).toBe(true);
    const ids = SEED_EVAL_RUNS.flatMap((r) => r.results.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...ids, SEED_EVAL_RUN_V1_ID, SEED_EVAL_RUN_V2_ID]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('parse as EvalSuiteRunDetail', () => {
    for (const r of SEED_EVAL_RUNS) expect(EvalSuiteRunDetail.safeParse(detailOf(r)).success, r.id).toBe(true);
  });

  it('cover every seeded case once and mirror its expectation, name and origin', () => {
    for (const r of SEED_EVAL_RUNS) {
      expect(r.results.map((x) => x.seed_key).sort()).toEqual(SEED_EVAL_CASES.map((c) => c.seed_key).sort());
      for (const x of r.results) {
        const c = byKey(x.seed_key);
        expect(x.expectation).toEqual(c.expectation);
        expect(x.case_name).toBe(c.name);
        expect(x.origin).toBe(c.origin);
      }
    }
  });

  it('stored metrics and counts equal scoreRun(results); labels and pass flags equal scoreCase', () => {
    for (const r of SEED_EVAL_RUNS) {
      expect(scoreRun(r.results)).toEqual({ metrics: r.metrics, counts: r.counts });
      for (const x of r.results) {
        const s = scoreCase(x.expectation, x.grounded);
        expect(x.grounded.map((f) => f.match), x.case_name).toEqual(s.labels);
        expect(x.pass, x.case_name).toBe(s.pass);
      }
      expect(r.duration_ms).toBe(r.results.reduce((n, x) => n + (x.duration_ms ?? 0), 0));
      expect(r.cost_usd).toBeCloseTo(r.results.reduce((n, x) => n + (x.cost_usd ?? 0), 0), 9);
    }
  });

  it('v2 improves recall and precision, with at least one regressed and two fixed cases versus v1', () => {
    const [v1, v2] = SEED_EVAL_RUNS as [(typeof SEED_EVAL_RUNS)[number], (typeof SEED_EVAL_RUNS)[number]];
    expect(v2.metrics.recall!).toBeGreaterThan(v1.metrics.recall!);
    expect(v2.metrics.precision!).toBeGreaterThan(v1.metrics.precision!);
    const pass1 = new Map(v1.results.map((x) => [x.seed_key, x.pass]));
    const fixed = v2.results.filter((x) => pass1.get(x.seed_key) === false && x.pass === true).map((x) => x.seed_key);
    const regressed = v2.results.filter((x) => pass1.get(x.seed_key) === true && x.pass === false).map((x) => x.seed_key);
    expect(fixed.length).toBeGreaterThanOrEqual(2);
    expect(regressed.length).toBeGreaterThanOrEqual(1);
  });

  it('is pure data: the fixture imports nothing from the DB layer', () => {
    const src = readFileSync(path.resolve(__dirname, '../src/db/fixtures/eval-cases.ts'), 'utf8');
    const specs = [...src.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]!);
    expect(specs).toEqual(['@devdigest/shared']);
  });
});
