import type { RepoRef, SpecReadEntry, SpecSkipReason } from '@devdigest/shared';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type { ProjectDocsSource } from './ports.js';
import type { EffectiveDoc } from './effective.js';
import { decodeUtf8Strict, isBlank } from './docs.js';
import { isContextDocPath, normalizeContextPath } from './paths.js';
import {
  PROJECT_CONTEXT_HARD_CEILING_TOKENS,
  PROJECT_CONTEXT_SOFT_CAP_TOKENS,
  RUN_READ_CONCURRENCY,
} from './constants.js';

export interface InjectedDoc {
  path: string;
  content: string;
  tokens: number;
}

export interface ResolvedProjectContext {
  /** One entry per effective doc, in effective order. */
  entries: SpecReadEntry[];
  /** Documents to inject, in effective order. */
  injected: InjectedDoc[];
  commitSha: string | null;
  injectedTokens: number;
  softCapExceeded: boolean;
}

export interface ResolveParams {
  source: ProjectDocsSource;
  repo: RepoRef;
  branch: string;
  effective: EffectiveDoc[];
  tokenizer: Pick<Tokenizer, 'count'>;
}

type Read =
  | { kind: 'skip'; reason: SpecSkipReason }
  | { kind: 'text'; text: string };

const entryOf = (
  d: EffectiveDoc,
  status: SpecReadEntry['status'],
  tokens: number | null,
  reason: SpecSkipReason | null,
): SpecReadEntry => ({
  path: d.path,
  tokens,
  status,
  reason,
  origin: d.origin,
  skill_name: d.skillName ?? null,
});

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Run-time resolution of the effective project-context docs against ONE commit of the
 * default branch. Never throws: every failure becomes a skipped entry (the run continues).
 */
export async function resolveProjectContext(p: ResolveParams): Promise<ResolvedProjectContext> {
  const { source, repo, branch, effective, tokenizer } = p;
  // Re-validate: a path stored in the DB is never trusted (AC-51).
  const valid = effective.map((d) => isContextDocPath(normalizeContextPath(d.path)));

  let commitSha: string | null = null;
  let headFailed = false;
  if (valid.some(Boolean)) {
    try {
      commitSha = await source.resolveBranchHead(repo, branch);
    } catch {
      headFailed = true;
    }
  }

  const reads: Read[] = await mapLimit(
    effective.map((d, i) => ({ d, ok: valid[i] as boolean })),
    RUN_READ_CONCURRENCY,
    async ({ d, ok }): Promise<Read> => {
      if (!ok) return { kind: 'skip', reason: 'invalid_path' };
      if (headFailed || commitSha === null) return { kind: 'skip', reason: 'read_error' };
      let bytes: Uint8Array | null;
      try {
        bytes = await source.readBlob(repo, normalizeContextPath(d.path), commitSha);
      } catch {
        return { kind: 'skip', reason: 'read_error' };
      }
      if (bytes === null) return { kind: 'skip', reason: 'not_found' };
      const text = decodeUtf8Strict(bytes);
      if (text === null) return { kind: 'skip', reason: 'not_text' };
      if (isBlank(text)) return { kind: 'skip', reason: 'empty' };
      return { kind: 'text', text };
    },
  );

  const entries: SpecReadEntry[] = [];
  const injected: InjectedDoc[] = [];
  let total = 0;
  let overflowed = false;
  effective.forEach((d, i) => {
    const r = reads[i] as Read;
    if (r.kind === 'skip') {
      entries.push(entryOf(d, 'skipped', null, r.reason));
      return;
    }
    const tokens = tokenizer.count(r.text);
    if (overflowed || total + tokens > PROJECT_CONTEXT_HARD_CEILING_TOKENS) {
      overflowed = true;
      entries.push(entryOf(d, 'skipped', tokens, 'over_budget'));
      return;
    }
    total += tokens;
    injected.push({ path: d.path, content: r.text, tokens });
    entries.push(entryOf(d, 'injected', tokens, null));
  });

  return {
    entries,
    injected,
    commitSha,
    injectedTokens: total,
    softCapExceeded: total > PROJECT_CONTEXT_SOFT_CAP_TOKENS,
  };
}
