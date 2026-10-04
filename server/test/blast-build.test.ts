import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { buildBlastRadius } from '../src/modules/blast/build.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastResult, DegradedReason } from '../src/modules/repo-intel/types.js';

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

  it('empty result gives an empty map and a summary with zeros', () => {
    const out = buildBlastRadius(base());
    expect(out.changed_symbols).toEqual([]);
    expect(out.downstream).toEqual([]);
    expect(out.summary).toBe(
      '0 changed symbol(s), 0 caller(s), 0 endpoint(s), 0 cron/job(s) affected.',
    );
    expect(() => BlastRadius.parse(out)).not.toThrow();
  });

  it('several callers of one symbol from different files stay under that symbol', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
        callers: [
          { file: 'src/x.ts', symbol: 'x1', viaSymbol: 'foo', line: 3, rank: 3 },
          { file: 'src/y.ts', symbol: 'y1', viaSymbol: 'foo', line: 9, rank: 2 },
          { file: 'src/z.ts', symbol: 'z1', viaSymbol: 'foo', line: 1, rank: 1 },
        ],
      }),
    );
    expect(out.downstream).toHaveLength(1);
    expect(out.downstream[0]!.callers.map((c) => c.file)).toEqual(['src/x.ts', 'src/y.ts', 'src/z.ts']);
  });

  it('one file calling two different symbols appears under both', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'src/a.ts', name: 'foo', kind: 'function' },
          { file: 'src/a.ts', name: 'bar', kind: 'function' },
        ],
        callers: [
          { file: 'src/x.ts', symbol: 'handler', viaSymbol: 'foo', line: 3, rank: 2 },
          { file: 'src/x.ts', symbol: 'handler', viaSymbol: 'bar', line: 4, rank: 2 },
        ],
      }),
    );
    const by = (sym: string) => out.downstream.find((d) => d.symbol === sym)!;
    expect(by('foo').callers).toEqual([{ name: 'handler', file: 'src/x.ts', line: 3 }]);
    expect(by('bar').callers).toEqual([{ name: 'handler', file: 'src/x.ts', line: 4 }]);
  });

  it.each<DegradedReason>(['flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data'])(
    'degraded:true with reason %s reaches the result',
    (reason) => {
      const out = buildBlastRadius(base({ degraded: true, reason }));
      expect(out.degraded).toBe(true);
      expect(out.reason).toBe(reason);
      expect(() => BlastRadius.parse(out)).not.toThrow();
    },
  );

  it('caps callers per symbol at MAX_CALLERS_PER_SYMBOL from repo-intel/constants.ts', () => {
    const over = MAX_CALLERS_PER_SYMBOL + 5;
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'src/a.ts', name: 'hot', kind: 'function' },
          { file: 'src/a.ts', name: 'small', kind: 'function' },
        ],
        callers: [
          ...Array.from({ length: over }, (_, i) => ({
            file: `src/h${i}.ts`,
            symbol: `h${i}`,
            viaSymbol: 'hot',
            line: i + 1,
            rank: 100 - i,
          })),
          { file: 'src/s.ts', symbol: 's', viaSymbol: 'small', line: 1, rank: 1 },
        ],
      }),
    );
    const by = (sym: string) => out.downstream.find((d) => d.symbol === sym)!;
    expect(by('hot').callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(by('hot').callers[0]!.name).toBe('h0'); // highest rank kept
    expect(by('small').callers).toHaveLength(1); // not starved by the hot symbol
  });

  it('the whole mapped result passes BlastRadius.parse()', () => {
    const out = buildBlastRadius(
      base({
        changedSymbols: [
          { file: 'src/a.ts', name: 'foo', kind: 'function' },
          { file: 'src/b.ts', name: 'idle', kind: 'class' },
        ],
        callers: [{ file: 'src/r.ts', symbol: 'route', viaSymbol: 'foo', line: 7, rank: 2 }],
        factsByFile: { 'src/r.ts': { endpoints: ['GET /x'], crons: ['nightly'] } },
        degraded: true,
        reason: 'index_partial',
      }),
    );
    expect(() => BlastRadius.parse(out)).not.toThrow();
    expect(out.downstream[0]).toMatchObject({
      symbol: 'foo',
      endpoints_affected: ['GET /x'],
      crons_affected: ['nightly'],
    });
  });
});
