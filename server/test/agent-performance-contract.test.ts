import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentPerformance } from '../src/modules/agent-performance/schemas.js';

/** Shared with the client mirror test: the same JSON must satisfy both sides. */
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../client/src/test/fixtures/agent-performance.sample.json', import.meta.url)),
    'utf8',
  ),
);

describe('AgentPerformance envelope', () => {
  it('the shared client fixture parses with the strict schema', () => {
    const p = AgentPerformance.parse(fixture);
    expect(p.cost_basis).toBe('estimate');
    expect(p.agents).toHaveLength(4);
  });

  it('rejects unknown top-level and totals fields (strict)', () => {
    expect(AgentPerformance.safeParse({ ...fixture, extra: 1 }).success).toBe(false);
    expect(AgentPerformance.safeParse({ ...fixture, totals: { ...fixture.totals, extra: 1 } }).success).toBe(false);
  });

  it('requires cost_basis "estimate" and allows a null most_active', () => {
    expect(AgentPerformance.safeParse({ ...fixture, cost_basis: 'billed' }).success).toBe(false);
    expect(AgentPerformance.safeParse({ ...fixture, most_active: null }).success).toBe(true);
  });

  it('every agent entry carries the SPEC-06 AgentStats fields', () => {
    const p = AgentPerformance.parse(fixture);
    for (const a of p.agents) expect(a.cost_basis).toBe('estimate');
  });

  it('fixture totals equal the per-agent sums (AC-24, AC-27, AC-28, AC-29)', () => {
    const p = AgentPerformance.parse(fixture);
    const sum = (f: (a: (typeof p.agents)[number]) => number) => p.agents.reduce((s, a) => s + f(a), 0);
    expect(p.totals.runs).toBe(sum((a) => a.runs));
    expect(p.totals.accepted).toBe(sum((a) => a.accepted));
    expect(p.totals.decisions).toBe(sum((a) => a.decisions));
    expect(p.totals.runs_excluded).toBe(sum((a) => a.runs_excluded));
    expect(p.totals.total_cost_usd!).toBeCloseTo(sum((a) => a.total_cost_usd ?? 0), 9);
    expect(p.cost_by_agent.reduce((s, c) => s + c.cost_usd, 0)).toBeCloseTo(p.totals.total_cost_usd!, 9);
    expect(p.cost_by_model.reduce((s, c) => s + c.cost_usd, 0)).toBeCloseTo(p.totals.total_cost_usd!, 9);
  });
});
