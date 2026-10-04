import { z } from 'zod';
import { BlastRadius, type DownstreamImpact } from '@devdigest/shared';
import type { BlastResult } from '../repo-intel/types.js';

/** Route response: the shared contract plus the repo-intel degradation flags. */
export const BlastResponseSchema = BlastRadius.extend({
  degraded: z.boolean(),
  reason: z.string().nullable(),
});
export type BlastResponse = z.infer<typeof BlastResponseSchema>;

/** Deterministic one-line summary from counts. No model call. */
export function buildSummary(counts: {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}): string {
  const { symbols, callers, endpoints, crons } = counts;
  if (symbols === 0) return 'No changed symbols found.';
  return (
    `${symbols} changed symbol(s), ${callers} caller(s), ` +
    `${endpoints} endpoint(s), ${crons} cron/job(s) affected.`
  );
}

/**
 * Pure mapping of the repo-intel blast result onto the `BlastRadius` contract.
 *
 * - `downstream` groups the flat caller rows by the changed symbol they reach (`viaSymbol`).
 *   Changed symbols without callers are kept as an empty group so the UI can still list them.
 * - a caller located in the file that declares the symbol is not a caller of that symbol.
 * - endpoints/crons per group come from the facts of that group's caller files, deduped.
 */
export function buildBlastRadius(result: BlastResult): BlastResponse {
  const facts = result.factsByFile ?? {};

  const groups = new Map<string, DownstreamImpact>();
  const ensure = (symbol: string): DownstreamImpact => {
    let g = groups.get(symbol);
    if (!g) {
      g = { symbol, callers: [], endpoints_affected: [], crons_affected: [] };
      groups.set(symbol, g);
    }
    return g;
  };

  for (const s of result.changedSymbols) ensure(s.name);

  // File that declares each changed symbol; a name declared in several changed files is
  // ambiguous and skipped, so only a certain self-reference is dropped.
  const declFiles = new Map<string, Set<string>>();
  for (const s of result.changedSymbols) {
    declFiles.set(s.name, (declFiles.get(s.name) ?? new Set<string>()).add(s.file));
  }
  const isSelfCaller = (viaSymbol: string, file: string): boolean => {
    const files = declFiles.get(viaSymbol);
    return files?.size === 1 && files.has(file);
  };

  // Best caller rank per symbol (the contract has no rank field): orders the groups below.
  const bestRank = new Map<string, number>();
  const callerSeen = new Set<string>();
  for (const c of result.callers) {
    if (isSelfCaller(c.viaSymbol, c.file)) continue;
    const key = `${c.viaSymbol}|${c.file}|${c.line}|${c.symbol}`;
    if (callerSeen.has(key)) continue;
    callerSeen.add(key);
    ensure(c.viaSymbol).callers.push({ name: c.symbol, file: c.file, line: c.line });
    bestRank.set(c.viaSymbol, Math.max(bestRank.get(c.viaSymbol) ?? -Infinity, c.rank));
  }

  // Endpoint/cron totals count only what is attributed to a caller group, so the summary
  // matches the per-symbol list the UI shows (the flat `impactedEndpoints` is not attributed).
  const allEndpoints = new Set<string>();
  const allCrons = new Set<string>();
  for (const g of groups.values()) {
    const eps = new Set<string>();
    const crons = new Set<string>();
    for (const c of g.callers) {
      for (const e of facts[c.file]?.endpoints ?? []) eps.add(e);
      for (const cr of facts[c.file]?.crons ?? []) crons.add(cr);
    }
    g.endpoints_affected = [...eps];
    g.crons_affected = [...crons];
    for (const e of eps) allEndpoints.add(e);
    for (const cr of crons) allCrons.add(cr);
  }

  // Most important first: best caller rank, then caller count. Array#sort is stable, so
  // ties (and symbols without callers) keep the order repo-intel reported them in.
  const downstream = [...groups.values()].sort(
    (a, b) =>
      (bestRank.get(b.symbol) ?? -Infinity) - (bestRank.get(a.symbol) ?? -Infinity) ||
      b.callers.length - a.callers.length,
  );
  const callerCount = downstream.reduce((n, g) => n + g.callers.length, 0);

  return {
    changed_symbols: result.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
    downstream,
    summary: buildSummary({
      symbols: result.changedSymbols.length,
      callers: callerCount,
      endpoints: allEndpoints.size,
      crons: allCrons.size,
    }),
    degraded: result.degraded === true,
    reason: result.reason ?? null,
  };
}
