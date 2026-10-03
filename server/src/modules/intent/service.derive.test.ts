import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentService } from './service.js';

const pull = { id: 'pr1', title: 'T', body: 'B', headSha: 'sha1' } as never;
const repo = { owner: 'o', name: 'r' };

const LLM_DATA = {
  summary: 'S',
  in_scope: ['a'],
  out_of_scope: [],
  confidence: 0.9,
  sources: [],
  missing_context: [],
};

const okLlm = (data: unknown = LLM_DATA) => ({
  completeStructured: vi.fn(async (_req: unknown) => ({
    data,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.002,
  })),
});

function makeService(opts: { cached?: unknown; llm: (id?: string) => unknown; github?: unknown }) {
  const upsertIntent = vi.fn();
  const container = { db: {}, llm: async (id?: string) => opts.llm(id) } as never;
  const github = (opts.github ?? {
    getIssue: async () => null,
    readRepoFile: async () => null,
  }) as never;
  const svc = new IntentService(container, github);
  (svc as unknown as { repo: unknown }).repo = {
    getIntent: async () => opts.cached,
    upsertIntent,
  };
  return { svc, upsertIntent };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('IntentService fallback to the main review model', () => {
  const fallback = { provider: 'anthropic' as never, model: 'main-model' };

  it('uses the fallback with a warning when the feature model provider cannot be set up', async () => {
    const main = okLlm();
    const { svc, upsertIntent } = makeService({
      llm: (id) => {
        if (id === 'openrouter') throw new Error('OPENROUTER_API_KEY is not configured');
        return main;
      },
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash', {
      fallback,
    });
    expect(res.status).toBe('derived');
    expect(main.completeStructured).toHaveBeenCalledTimes(1);
    const req = main.completeStructured.mock.calls[0]![0] as { model: string };
    expect(req.model).toBe('main-model');
    expect(res.meta?.warnings.join(' ')).toMatch(
      /openrouter\/flash.*OPENROUTER_API_KEY.*anthropic\/main-model/,
    );
    expect(res.meta?.model).toBe('anthropic/main-model');
    expect((upsertIntent.mock.calls[0]![1] as { model: string }).model).toBe(
      'anthropic/main-model',
    );
  });

  it('does not fall back (and adds no warning) when the feature model works', async () => {
    const { svc } = makeService({ llm: () => okLlm() });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash', {
      fallback,
    });
    expect(res.meta?.warnings).toEqual([]);
    expect(res.meta?.model).toBe('openrouter/flash');
  });

  it('is fail-open (failed, no throw) with no fallback, or when the fallback is also unavailable', async () => {
    const unavailable = () => {
      throw new Error('no key');
    };
    const a = makeService({ llm: unavailable });
    expect(
      (await a.svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash')).status,
    ).toBe('failed');
    const b = makeService({ llm: unavailable });
    const res = await b.svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash', {
      fallback,
    });
    expect(res.status).toBe('failed');
    expect(b.upsertIntent).not.toHaveBeenCalled();
  });

  it('skips the fallback when it is the same model as the failing one', async () => {
    const { svc } = makeService({
      llm: () => {
        throw new Error('no key');
      },
    });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash', {
      fallback: { provider: 'openrouter' as never, model: 'flash' },
    });
    expect(res.status).toBe('failed');
  });
});

describe('IntentService confidence rules', () => {
  const run = async (pullRow: unknown, github?: unknown) => {
    const { svc, upsertIntent } = makeService({ llm: () => okLlm(), github });
    const res = await svc.deriveIntentDetailed(
      pullRow as never,
      repo,
      [],
      'openrouter' as never,
      'm',
    );
    return { res, saved: upsertIntent.mock.calls[0]?.[1] as Record<string, unknown> };
  };
  const issueGh = {
    getIssue: async () => ({ number: 3, title: 'Issue', body: 'details', state: 'open' }),
    readRepoFile: async () => null,
  };

  it('0.0 when there are no sources and the description is empty', async () => {
    const { res, saved } = await run({ ...(pull as object), body: '' });
    expect(res.intent?.confidence).toBe(0);
    expect(saved.confidence).toBe(0);
    expect(saved.basis).toBe('files_only');
  });

  it('0.0 for a whitespace-only body, and when the only referenced source is unavailable', async () => {
    const a = await run({ ...(pull as object), body: '  \n ' });
    expect(a.res.intent?.confidence).toBe(0);
    const b = await run({ ...(pull as object), title: 'Fix (#3)', body: '' }); // issue -> null
    expect(b.res.intent?.confidence).toBe(0);
  });

  it('capped at 0.4 (not 0) for an empty body when a source was fetched', async () => {
    const { res } = await run({ ...(pull as object), title: 'Fix (#3)', body: '' }, issueGh);
    expect(res.intent?.confidence).toBe(0.4);
  });

  it('does not touch the confidence when there is a body', async () => {
    const { res } = await run(pull);
    expect(res.intent?.confidence).toBe(0.9);
  });
});

describe('IntentService persisted sources come from the resolver, not the LLM', () => {
  it('ignores LLM-reported statuses/labels; uses code-owned statuses', async () => {
    const lying = {
      ...LLM_DATA,
      sources: [
        { label: 'Linked issue #3', status: 'fetched' },
        { label: 'Plan at docs/plan.md', status: 'fetched' },
        { label: 'Totally invented', status: 'fetched' },
      ],
    };
    const github = {
      getIssue: async () => {
        throw Object.assign(new Error('Not Found'), { status: 404 });
      },
      readRepoFile: async () => {
        throw new Error('network down');
      },
    };
    const { svc, upsertIntent } = makeService({ llm: () => okLlm(lying), github });
    const res = await svc.deriveIntentDetailed(
      { ...(pull as object), body: 'fixes #3, see docs/plan.md' } as never,
      repo,
      [{ path: 'a.ts' }],
      'openrouter' as never,
      'm',
    );
    const expected = [
      { label: 'PR title', status: 'fetched' },
      { label: 'PR body', status: 'fetched' },
      { label: 'Changed files', status: 'fetched' },
      { label: 'Linked issue #3', status: 'unavailable' },
      { label: 'Plan at docs/plan.md', status: 'error' },
    ];
    expect(res.intent?.sources).toEqual(expected);
    expect((upsertIntent.mock.calls[0]![1] as { sources: unknown }).sources).toEqual(expected);
  });

  it('mentions referenced-but-unavailable docs in the prompt as "no context"', async () => {
    const llm = okLlm();
    const { svc } = makeService({ llm: () => llm });
    await svc.deriveIntentDetailed(
      { ...(pull as object), body: 'see docs/plan.md' } as never,
      repo,
      [],
      'openrouter' as never,
      'm',
    );
    const req = llm.completeStructured.mock.calls[0]![0] as { messages: { content: string }[] };
    const user = req.messages[1]!.content;
    expect(user).toMatch(/no context/i);
    expect(user).toContain('Plan at docs/plan.md');
  });
});

describe('IntentService meta, warnings, cache and force', () => {
  const files100 = Array.from({ length: 100 }, (_, i) => ({ path: `f${i}.ts` }));

  it('warns when the PR has >= 100 files (prompt cap), not below', async () => {
    const a = makeService({ llm: () => okLlm() });
    const r100 = await a.svc.deriveIntentDetailed(pull, repo, files100, 'openrouter' as never, 'm');
    expect(r100.meta?.warnings.join(' ')).toMatch(/100 files/);
    const b = makeService({ llm: () => okLlm() });
    const r99 = await b.svc.deriveIntentDetailed(
      pull,
      repo,
      files100.slice(1),
      'openrouter' as never,
      'm',
    );
    expect(r99.meta?.warnings).toEqual([]);
  });

  it('reports cache miss + tokens/cost on derive and the ref statuses', async () => {
    const { svc } = makeService({ llm: () => okLlm() });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res.meta).toMatchObject({ cache: 'miss', tokens: 15, costUsd: 0.002, refStatuses: {} });
  });

  it('reports cache hit, and force bypasses it', async () => {
    const first = makeService({ llm: () => okLlm() });
    await first.svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    const saved = first.upsertIntent.mock.calls[0]![1] as Record<string, unknown>;
    const cached = {
      summary: saved.summary,
      inScope: saved.in_scope,
      outOfScope: saved.out_of_scope,
      confidence: saved.confidence,
      sources: saved.sources,
      missingContext: saved.missing_context,
      derivedFromHeadSha: 'sha1',
      cacheKeyHash: saved.cacheKeyHash,
    };
    const llm = okLlm();
    const hit = makeService({ cached, llm: () => llm });
    const res = await hit.svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'm');
    expect(res).toMatchObject({ status: 'cached', meta: { cache: 'hit' } });
    expect(llm.completeStructured).not.toHaveBeenCalled();

    const forced = makeService({ cached, llm: () => llm });
    const res2 = await forced.svc.deriveIntentDetailed(
      pull,
      repo,
      [],
      'openrouter' as never,
      'm',
      { force: true },
    );
    expect(res2).toMatchObject({ status: 'derived', meta: { cache: 'bypass' } });
    expect(llm.completeStructured).toHaveBeenCalledTimes(1);
    expect(forced.upsertIntent).toHaveBeenCalledTimes(1);
  });
});

describe('IntentService grounds out_of_scope in the PR text', () => {
  it('drops exclusions copied from the old prompt example and warns, keeps grounded ones', async () => {
    const llm = okLlm({
      ...LLM_DATA,
      out_of_scope: ['admin dashboard', 'email verification', 'the billing module'],
    });
    const p = { id: 'pr1', title: 'Add rate limiting', body: 'Not touching the billing module.', headSha: 'sha1' } as never;
    const { svc, upsertIntent } = makeService({ llm: () => llm });
    const res = await svc.deriveIntentDetailed(p, repo, [], 'openrouter' as never, 'flash', {});
    expect(res.status).toBe('derived');
    expect(res.intent?.out_of_scope).toEqual(['the billing module']);
    expect((upsertIntent.mock.calls[0]![1] as { out_of_scope: string[] }).out_of_scope).toEqual(['the billing module']);
    expect(res.meta?.warnings.join(' ')).toMatch(/dropped 2 out_of_scope item\(s\) not grounded/);
  });

  it('keeps an empty out_of_scope as is, without a warning', async () => {
    const { svc } = makeService({ llm: () => okLlm() });
    const res = await svc.deriveIntentDetailed(pull, repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.out_of_scope).toEqual([]);
    expect(res.meta?.warnings.join(' ')).not.toMatch(/out_of_scope/);
  });
});

describe('IntentService confidence ceiling from source evidence', () => {
  const body = (b: string) => ({ id: 'pr1', title: 'T', body: b, headSha: 'sha1' }) as never;
  const github404 = { getIssue: async () => null, readRepoFile: async () => null };

  it('an explicitly linked ticket that is unavailable caps the model confidence at 0.5', async () => {
    const { svc, upsertIntent } = makeService({ llm: () => okLlm(), github: github404 });
    const res = await svc.deriveIntentDetailed(body('Implements x. Closes #5.'), repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.confidence).toBe(0.5);
    expect((upsertIntent.mock.calls[0]![1] as { confidence: number }).confidence).toBe(0.5);
    expect(res.meta?.warnings.join(' ')).toMatch(/confidence capped at 0\.5/);
  });

  it('an unavailable plan document caps at 0.5 too', async () => {
    const { svc } = makeService({ llm: () => okLlm(), github: github404 });
    const res = await svc.deriveIntentDetailed(body('Implements x, see docs/plan.md'), repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.confidence).toBe(0.5);
  });

  it('an implicit #N that does not resolve does not lower confidence (it is dropped)', async () => {
    const { svc } = makeService({ llm: () => okLlm(), github: github404 });
    const res = await svc.deriveIntentDetailed(body('Implements x. See seeded PR #482.'), repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.confidence).toBe(0.9);
    expect(res.meta?.warnings.join(' ')).not.toMatch(/confidence capped/);
  });

  it('a cross-repository reference that cannot be fetched caps at 0.7', async () => {
    const { svc } = makeService({ llm: () => okLlm(), github: github404 });
    const res = await svc.deriveIntentDetailed(body('Implements x. Fixes https://github.com/a/b/issues/9'), repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.confidence).toBe(0.7);
  });

  it('a model value below the ceiling is kept (min, never raised)', async () => {
    const { svc } = makeService({ llm: () => okLlm({ ...LLM_DATA, confidence: 0.3 }), github: github404 });
    const res = await svc.deriveIntentDetailed(body('Implements x. Closes #5.'), repo, [], 'openrouter' as never, 'flash', {});
    expect(res.intent?.confidence).toBe(0.3);
  });

  it('the real case: 0.9 from the model, plan and ticket unavailable -> 0.5', async () => {
    const { svc } = makeService({ llm: () => okLlm({ ...LLM_DATA, confidence: 0.9 }), github: github404 });
    const res = await svc.deriveIntentDetailed(
      body('seeded PR #482 -> run card. `server/docs/architecture.md` exists. Closes #482'),
      repo,
      [],
      'openrouter' as never,
      'flash',
      {},
    );
    expect(res.intent?.confidence).toBe(0.5);
  });
});
