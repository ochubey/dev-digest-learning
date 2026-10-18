import { describe, it, expect } from 'vitest';
import { PeriodQuery, resolvePeriod, inPeriod } from '../src/modules/agent-performance/period.js';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const ok = (q: unknown) => PeriodQuery.safeParse(q);

describe('PeriodQuery', () => {
  it('accepts no params', () => {
    expect(ok({}).success).toBe(true);
  });

  it('accepts a valid pair with Z and with an offset', () => {
    expect(ok({ from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00.000Z' }).success).toBe(true);
    expect(ok({ from: '2026-09-01T02:00:00+02:00', to: '2026-10-01T00:00:00-05:00' }).success).toBe(true);
  });

  it('rejects only one of from/to', () => {
    expect(ok({ from: '2026-09-01T00:00:00Z' }).success).toBe(false);
    expect(ok({ to: '2026-09-01T00:00:00Z' }).success).toBe(false);
  });

  it('rejects from >= to', () => {
    expect(ok({ from: '2026-09-01T00:00:00Z', to: '2026-09-01T00:00:00Z' }).success).toBe(false);
    expect(ok({ from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' }).success).toBe(false);
  });

  it('allows exactly 366 days, rejects 367', () => {
    expect(ok({ from: '2025-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }).success).toBe(true); // 366 d
    expect(ok({ from: '2025-01-01T00:00:00Z', to: '2026-01-03T00:00:00Z' }).success).toBe(false); // 367 d
  });

  it.each(['', 'yesterday', '2026-09-01', '2026-09-01T00:00:00', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', '1700000000'])(
    'rejects invalid instant %j',
    (v) => {
      expect(ok({ from: v, to: '2026-10-01T00:00:00Z' }).success).toBe(false);
      expect(ok({ from: '2026-09-01T00:00:00Z', to: v }).success).toBe(false);
    },
  );
});

describe('resolvePeriod', () => {
  it('no params: [now-30d, now)', () => {
    const p = resolvePeriod({}, NOW);
    expect(p.to.toISOString()).toBe('2026-10-18T12:00:00.000Z');
    expect(p.from.toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });

  it('echoes an offset input as UTC Z', () => {
    const p = resolvePeriod({ from: '2026-09-01T02:00:00+02:00', to: '2026-10-01T02:00:00+02:00' }, NOW);
    expect(p.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('inPeriod (half-open)', () => {
  const p = resolvePeriod({ from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }, NOW);
  it('at from is in, at to is out, to-1ms is in, from-1ms is out', () => {
    expect(inPeriod(new Date('2026-09-01T00:00:00.000Z'), p)).toBe(true);
    expect(inPeriod(new Date('2026-09-02T00:00:00.000Z'), p)).toBe(false);
    expect(inPeriod(new Date('2026-09-01T23:59:59.999Z'), p)).toBe(true);
    expect(inPeriod(new Date('2026-08-31T23:59:59.999Z'), p)).toBe(false);
  });
});
