import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentService } from './service.js';

const pull = { id: 'pr1', title: 'T', body: 'B', headSha: 'sha1' } as never;
const repo = { owner: 'o', name: 'r' };

function makeService(opts: { cached?: unknown; llm: () => unknown }) {
  const upsertIntent = vi.fn();
  const container = { db: {}, llm: async () => opts.llm() } as never;
  const github = { getIssue: async () => null, readRepoFile: async () => null } as never;
  const svc = new IntentService(container, github);
  (svc as unknown as { repo: unknown }).repo = {
    getIntent: async () => opts.cached,
    upsertIntent,
  };
  return { svc, upsertIntent };
}

const LLM_DATA = {
  summary: 'S',
  in_scope: ['a'],
  out_of_scope: [],
  confidence: 0.9,
  sources: [],
  missing_context: [],
};

describe('IntentService.deriveIntentDetailed', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('reports failed (with the error) instead of throwing when the LLM throws', async () => {
    const { svc, upsertIntent } = makeService({
      llm: () => ({
        completeStructured: async () => {
          throw new Error('llm boom');
        },
      }),
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    // one HTTP attempt was made and errored: attempts=1 (lower bound), not 0
    expect(res).toMatchObject({ status: 'failed', error: 'llm boom', attempts: 1 });
    expect(upsertIntent).not.toHaveBeenCalled();
    // deriveIntent stays fail-open
    expect(await svc.deriveIntent(pull, repo, [], 'openrouter' as never, 'm')).toBeUndefined();
  });

  it('reports derived and persists on a real LLM call', async () => {
    const complete = vi.fn(async () => ({ data: LLM_DATA, tokensIn: 1, tokensOut: 2, costUsd: 0 }));
    const { svc, upsertIntent } = makeService({ llm: () => ({ completeStructured: complete }) });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res.status).toBe('derived');
    expect(res.intent?.summary).toBe('S');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(upsertIntent).toHaveBeenCalledTimes(1);
    expect(res.attempts).toBe(1); // provider reported no attempts -> one call
  });

  it('reports the real attempt count (reprompts included) from completeStructured', async () => {
    const complete = vi.fn(async () => ({ data: LLM_DATA, tokensIn: 1, tokensOut: 2, costUsd: 0, attempts: 3 }));
    const { svc } = makeService({ llm: () => ({ completeStructured: complete }) });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res).toMatchObject({ status: 'derived', attempts: 3 });
  });

  it('reports cached (no LLM call) when sha and metadata hash match', async () => {
    const complete = vi.fn();
    // first derive to learn the hash
    const first = makeService({
      llm: () => ({ completeStructured: async () => ({ data: LLM_DATA, tokensIn: 0, tokensOut: 0 }) }),
    });
    await first.svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    const saved = first.upsertIntent.mock.calls[0]![1] as Record<string, unknown>;

    const { svc } = makeService({
      cached: {
        summary: saved.summary,
        inScope: saved.in_scope,
        outOfScope: saved.out_of_scope,
        confidence: saved.confidence,
        sources: saved.sources,
        missingContext: saved.missing_context,
        derivedFromHeadSha: 'sha1',
        cacheKeyHash: saved.cacheKeyHash,
      },
      llm: () => ({ completeStructured: complete }),
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res.status).toBe('cached');
    expect(res.attempts).toBe(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it('failed after the LLM call: meta still carries cache miss + resolved refs, attempts=1', async () => {
    const { svc } = makeService({
      llm: () => ({
        completeStructured: async () => {
          throw new Error('llm boom');
        },
      }),
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm', { force: true });
    expect(res.status).toBe('failed');
    expect(res.attempts).toBe(1);
    expect(res.meta).toMatchObject({ cache: 'bypass', refsReached: true });
  });

  it('failed before the LLM call (provider setup): attempts=0, load + refs still reported', async () => {
    const { svc } = makeService({
      llm: () => {
        throw new Error('no key');
      },
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res).toMatchObject({ status: 'failed', error: 'no key', attempts: 0 });
    expect(res.meta).toMatchObject({ cache: 'miss', refsReached: true });
  });

  it('cache lookup failure: load reported as not_reached, refs were resolved', async () => {
    const { svc } = makeService({ llm: () => ({}) });
    (svc as unknown as { repo: unknown }).repo = {
      getIntent: async () => {
        throw new Error('db down');
      },
      upsertIntent: vi.fn(),
    };
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res).toMatchObject({ status: 'failed', error: 'db down', attempts: 0 });
    expect(res.meta).toMatchObject({ cache: 'not_reached', refsReached: true });
  });

  it('files come from the caller (loaded diff): prompt stats count them even if pr_files is empty', async () => {
    const { svc } = makeService({
      llm: () => ({
        completeStructured: async () => ({ data: LLM_DATA, tokensIn: 1, tokensOut: 1, costUsd: 0 }),
      }),
    });
    const res = await svc.deriveIntentDetailed(
      pull,
      repo,
      [{ path: 'a.ts', patch: '@@ -1 +1 @@' }, { path: 'b.ts', patch: '@@ -2 +2 @@' }],
      'openrouter' as never,
      'm',
    );
    expect(res.meta?.prompt).toMatchObject({ files: 2, filesIncluded: 2, hunkHeaders: 2 });
  });
});
