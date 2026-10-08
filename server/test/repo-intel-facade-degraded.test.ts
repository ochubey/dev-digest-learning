import { describe, it, expect } from 'vitest';
import { RepoIntelService, capCallersPerSymbol } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { RepoBasics } from '../src/modules/repo-intel/repository.js';
import type { IndexState } from '../src/modules/repo-intel/types.js';

/**
 * T1.4 — Facade degraded contract (acceptance #10).
 *
 * When `repoIntelEnabled=false` (opt-out; the default is now ON), every facade
 * method MUST return a safe degraded value WITHOUT throwing. Consumers (run-executor,
 * blast, hooks) downgrade to their pre-T1.3 behavior on these returns; if any
 * method threw or returned malformed shape, every consumer would crash.
 *
 * No Postgres, no clone. The service's `repo` (RepoIntelRepository) is patched
 * to return null/[] so we exercise the degraded paths cleanly.
 */

function buildDegradedService(opts: {
  flag: boolean;
  basics?: RepoBasics | null;
  indexStateRow?: IndexState | null;
}): RepoIntelService {
  const container = {
    config: { repoIntelEnabled: opts.flag },
    db: {} as never,
    // codeIndex is reached by getBlastRadius; we stub minimal behaviour.
    codeIndex: {
      symbols: async () => [],
      references: async () => [],
    } as never,
  } as never;
  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    getRepoBasics: async () => opts.basics ?? null,
    tryGetIndexState: async () => opts.indexStateRow ?? null,
    getCachedSymbols: async () => [],
    getCachedSymbolsForFiles: async () => [],
    getCachedReferencesTo: async () => [],
  };
  return svc;
}

describe('RepoIntel facade — degraded contract (flag off)', () => {
  it('getUnresolvedReferences → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures → [] when repoIntelEnabled=false', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getBlastRadius → degraded-but-valid shape (never throws)', async () => {
    const svc = buildDegradedService({ flag: false, basics: null });
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    // Shape (every key present, arrays where arrays go) — consumers assume this.
    expect(Array.isArray(blast.changedSymbols)).toBe(true);
    expect(Array.isArray(blast.callers)).toBe(true);
    expect(Array.isArray(blast.impactedEndpoints)).toBe(true);
    expect(blast.degraded).toBe(true);
    // reason is one of the documented DegradedReason values
    expect(['flag_off', 'no_data', 'index_failed', 'index_partial', 'repo_too_large'])
      .toContain(blast.reason);
  });

  it('getIndexState → degraded row (never throws) when no row exists', async () => {
    const svc = buildDegradedService({ flag: false, indexStateRow: null });
    const state = await svc.getIndexState('r1');
    // Always-present fields the UI / dashboard rely on (client bind).
    expect(state.repoId).toBe('r1');
    expect(state.status).toBe('degraded');
    expect(state.filesIndexed).toBe(0);
    expect(state.filesSkipped).toBe(0);
    expect(state.lastIndexedSha).toBe(''); // empty string, not undefined — JSON-safe
    expect(state.indexerVersion).toBeGreaterThanOrEqual(1);
    expect(state.updatedAt instanceof Date).toBe(true);
    expect(state.degraded).toBe(true);
  });

  it('getRepoMap → degraded ({ text:"", tokens:0, cached:false, degraded:true })', async () => {
    const svc = buildDegradedService({ flag: false });
    const map = await svc.getRepoMap('r1');
    expect(map.text).toBe('');
    expect(map.tokens).toBe(0);
    expect(map.cached).toBe(false);
    expect(map.degraded).toBe(true);
  });

  it('getFileRank / getSymbolsInFiles / getConventionSamples / getTopFilesByRank / getCriticalPaths → []', async () => {
    const svc = buildDegradedService({ flag: false });
    await expect(svc.getFileRank('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getSymbolsInFiles('r1', ['a.ts'])).resolves.toEqual([]);
    await expect(svc.getConventionSamples('r1', 12)).resolves.toEqual([]);
    await expect(svc.getTopFilesByRank('r1', 7)).resolves.toEqual([]);
    await expect(svc.getCriticalPaths('r1')).resolves.toEqual([]);
  });

  it('indexRepo / refreshIndex → degraded T1 skeleton (never throws)', async () => {
    const svc = buildDegradedService({ flag: false });
    const a = await svc.indexRepo('r1');
    const b = await svc.refreshIndex('r1');
    expect(a.status).toBe('degraded');
    expect(b.status).toBe('degraded');
    expect(a.filesIndexed).toBe(0);
    expect(b.filesIndexed).toBe(0);
  });
});

describe('RepoIntel facade — degraded contract (flag on, but no data)', () => {
  it('getCallerSignatures with no clone → [] (graceful degrade, no throw)', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getCallerSignatures('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getUnresolvedReferences with no clone → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: null } });
    await expect(svc.getUnresolvedReferences('r1', ['a.ts'])).resolves.toEqual([]);
  });

  it('getCallerSignatures with empty changedFiles → []', async () => {
    const svc = buildDegradedService({ flag: true, basics: { id: 'r1', owner: 'a', name: 'b', clonePath: '/tmp' } });
    await expect(svc.getCallerSignatures('r1', [])).resolves.toEqual([]);
  });
});

describe('RepoIntel facade — persistent blast reports an incomplete index', () => {
  function persistentService(status: 'full' | 'partial'): RepoIntelService {
    const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
    const svc = new RepoIntelService(container);
    (svc as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => ({ status }),
      getSymbolRows: async (_id: string, files: string[]) =>
        files.includes('a.ts') ? [{ path: 'a.ts', name: 'foo', kind: 'function', line: 1 }] : [],
      getResolvedCallers: async () => [],
      getFileFacts: async () => [],
    };
    return svc;
  }

  it('partial index -> degraded index_partial (never a silent "no callers")', async () => {
    const blast = await persistentService('partial').getBlastRadius('r1', ['a.ts']);
    expect(blast.changedSymbols).toHaveLength(1);
    expect(blast.callers).toEqual([]);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('index_partial');
  });

  it('full index -> not degraded', async () => {
    const blast = await persistentService('full').getBlastRadius('r1', ['a.ts']);
    expect(blast.degraded).toBe(false);
    expect(blast.reason).toBeUndefined();
  });
});

describe('RepoIntel facade — caller cap is per changed symbol', () => {
  const row = (viaSymbol: string, i: number, rank: number) => ({
    file: `src/${viaSymbol}${i}.ts`,
    symbol: `c${i}`,
    viaSymbol,
    line: i,
    rank,
  });

  it('capCallersPerSymbol keeps the first N of each symbol and keeps small symbols whole', () => {
    const hot = Array.from({ length: 25 }, (_, i) => row('hot', i, 100 - i));
    const small = [row('small', 0, 1), row('small', 1, 1), row('small', 2, 1)];
    const out = capCallersPerSymbol([...hot, ...small]);
    expect(out.filter((c) => c.viaSymbol === 'hot')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(out.filter((c) => c.viaSymbol === 'small')).toHaveLength(3);
    // the hot symbol keeps its highest-ranked callers
    expect(out.filter((c) => c.viaSymbol === 'hot').map((c) => c.symbol)).toEqual(
      hot.slice(0, MAX_CALLERS_PER_SYMBOL).map((c) => c.symbol),
    );
  });

  it('persistent blast: a hot symbol no longer starves the others', async () => {
    const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
    const svc = new RepoIntelService(container);
    const refs = [
      ...Array.from({ length: 30 }, (_, i) => ({ fromPath: `h${i}.ts`, toSymbol: 'hot', line: i, rank: 9 })),
      { fromPath: 'low.ts', toSymbol: 'small', line: 1, rank: 0.1 },
    ];
    (svc as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => ({ status: 'full' }),
      getSymbolRows: async (_id: string, files: string[]) =>
        files.includes('a.ts')
          ? [
              { path: 'a.ts', name: 'hot', kind: 'function', line: 1 },
              { path: 'a.ts', name: 'small', kind: 'function', line: 5 },
            ]
          : [],
      getResolvedCallers: async () => refs,
      getFileFacts: async () => [],
    };
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    const by = (sym: string) => blast.callers.filter((c) => c.viaSymbol === sym);
    expect(by('hot')).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(by('small')).toHaveLength(1); // was dropped when the cap covered the whole list
  });
});

describe('RepoIntel facade — getBlastRadius never throws', () => {
  it('a DB error becomes degraded index_failed instead of an exception', async () => {
    const container = { config: { repoIntelEnabled: true }, db: {} as never } as never;
    const svc = new RepoIntelService(container);
    (svc as unknown as { repo: Record<string, unknown> }).repo = {
      tryGetIndexState: async () => {
        throw new Error('connection terminated');
      },
    };
    const blast = await svc.getBlastRadius('r1', ['a.ts']);
    expect(blast).toMatchObject({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
      degraded: true,
      reason: 'index_failed',
    });
  });
});

