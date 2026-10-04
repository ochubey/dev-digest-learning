import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { buildBlastRadius } from '../src/modules/blast/build.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

const base = (over: Partial<BlastResult> = {}): BlastResult => ({
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  ...over,
});

describe('buildBlastRadius', () => {
  it('groups callers by viaSymbol and maps fields', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'src/a.ts', name: 'foo', kind: 'function' },
          { file: 'src/a.ts', name: 'bar', kind: 'function' },
        ],
        callers: [
          { file: 'src/x.ts', symbol: 'x1', viaSymbol: 'foo', line: 3, rank: 1 },
          { file: 'src/y.ts', symbol: 'y1', viaSymbol: 'foo', line: 9, rank: 1 },
          { file: 'src/x.ts', symbol: 'x2', viaSymbol: 'bar', line: 5, rank: 1 },
        ],
      }),
    );
    expect(out.downstream.map((d) => [d.symbol, d.callers.length])).toEqual([
      ['foo', 2],
      ['bar', 1],
    ]);
    expect(out.downstream[0]!.callers[0]).toEqual({ name: 'x1', file: 'src/x.ts', line: 3 });
    expect(out.changed_symbols[0]).toEqual({ name: 'foo', file: 'src/a.ts', kind: 'function' });
    expect(() => BlastRadius.parse(out)).not.toThrow();
  });

  it('keeps symbols without callers as empty groups', () => {
    const out = buildBlastRadius(
      base({ changedSymbols: [{ file: 'a.ts', name: 'lonely', kind: 'function' }] }),
    );
    expect(out.downstream).toEqual([
      { symbol: 'lonely', callers: [], endpoints_affected: [], crons_affected: [] },
    ]);
  });

  it('attributes endpoints/crons from caller-file facts, deduped per group', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'function' }],
        callers: [
          { file: 'r1.ts', symbol: 'h1', viaSymbol: 'foo', line: 1, rank: 1 },
          { file: 'r1.ts', symbol: 'h2', viaSymbol: 'foo', line: 2, rank: 1 },
          { file: 'r2.ts', symbol: 'h3', viaSymbol: 'foo', line: 3, rank: 1 },
        ],
        factsByFile: {
          'r1.ts': { endpoints: ['GET /a'], crons: ['nightly'] },
          'r2.ts': { endpoints: ['GET /a', 'POST /b'], crons: [] },
        },
      }),
    );
    expect(out.downstream[0]!.endpoints_affected).toEqual(['GET /a', 'POST /b']);
    expect(out.downstream[0]!.crons_affected).toEqual(['nightly']);
    expect(out.summary).toBe(
      '1 changed symbol(s), 3 caller(s), 2 endpoint(s), 1 cron/job(s) affected.',
    );
  });

  it('drops exact duplicate caller rows', () => {
    const row = { file: 'x.ts', symbol: 's', viaSymbol: 'foo', line: 1, rank: 0 };
    const out = buildBlastRadius(
      base({ changedSymbols: [{ file: 'a.ts', name: 'foo', kind: 'f' }], callers: [row, row] }),
    );
    expect(out.downstream[0]!.callers).toHaveLength(1);
  });

  it('orders symbols by best caller rank, then caller count; no-caller symbols last', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'a.ts', name: 'idle', kind: 'function' },
          { file: 'a.ts', name: 'low', kind: 'function' },
          { file: 'a.ts', name: 'many', kind: 'function' },
          { file: 'a.ts', name: 'top', kind: 'function' },
        ],
        callers: [
          { file: 'x.ts', symbol: 'c1', viaSymbol: 'low', line: 1, rank: 1 },
          { file: 'x.ts', symbol: 'c2', viaSymbol: 'many', line: 2, rank: 5 },
          { file: 'y.ts', symbol: 'c3', viaSymbol: 'many', line: 3, rank: 2 },
          { file: 'z.ts', symbol: 'c4', viaSymbol: 'top', line: 4, rank: 9 },
        ],
      }),
    );
    expect(out.downstream.map((d) => d.symbol)).toEqual(['top', 'many', 'low', 'idle']);
  });

  it('breaks rank ties by caller count', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'a.ts', name: 'one', kind: 'function' },
          { file: 'a.ts', name: 'two', kind: 'function' },
        ],
        callers: [
          { file: 'x.ts', symbol: 'c1', viaSymbol: 'one', line: 1, rank: 3 },
          { file: 'x.ts', symbol: 'c2', viaSymbol: 'two', line: 2, rank: 3 },
          { file: 'y.ts', symbol: 'c3', viaSymbol: 'two', line: 3, rank: 1 },
        ],
      }),
    );
    expect(out.downstream.map((d) => d.symbol)).toEqual(['two', 'one']);
  });

  it('does not list a symbol\'s declaring file as its own caller', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [
          { file: 'src/a.ts', symbol: 'inner', viaSymbol: 'foo', line: 2, rank: 1 },
          { file: 'src/x.ts', symbol: 'x1', viaSymbol: 'foo', line: 3, rank: 1 },
        ],
      }),
    );
    expect(out.downstream[0]!.callers).toEqual([{ name: 'x1', file: 'src/x.ts', line: 3 }]);
  });

  it('keeps callers when the symbol name is declared in several changed files (ambiguous)', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'src/a.ts', name: 'foo', kind: 'function' },
          { file: 'src/b.ts', name: 'foo', kind: 'function' },
        ],
        callers: [{ file: 'src/a.ts', symbol: 'inner', viaSymbol: 'foo', line: 2, rank: 1 }],
      }),
    );
    expect(out.downstream[0]!.callers).toHaveLength(1);
  });

  it('summary endpoint count ignores unattributed impactedEndpoints (no factsByFile)', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [{ file: 'src/x.ts', symbol: 'x1', viaSymbol: 'foo', line: 3, rank: 0 }],
        impactedEndpoints: ['GET /a', 'POST /b'],
        degraded: true,
        reason: 'no_data',
      }),
    );
    expect(out.downstream[0]!.endpoints_affected).toEqual([]);
    expect(out.summary).toBe(
      '1 changed symbol(s), 1 caller(s), 0 endpoint(s), 0 cron/job(s) affected.',
    );
  });

  it('passes degraded/reason through; defaults to not degraded', () => {
    expect(buildBlastRadius(base({ degraded: true, reason: 'index_partial' }))).toMatchObject({
      degraded: true,
      reason: 'index_partial',
    });
    expect(buildBlastRadius(base())).toMatchObject({ degraded: false, reason: null });
  });

  it('empty result gives a deterministic summary', () => {
    expect(buildBlastRadius(base()).summary).toBe('No changed symbols found.');
  });
});
