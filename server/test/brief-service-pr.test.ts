/**
 * BriefService.get and BriefService.generateForPr with stub reads and a stubbed `generate`.
 * No DB, no model: the orchestration (404/403, admission, logging, release, stale) is under test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({ logSpy: vi.fn() }));
vi.mock('../src/modules/brief/log-line.js', async (importActual) => ({
  ...(await importActual<typeof import('../src/modules/brief/log-line.js')>()),
  logBriefGeneration: hoisted.logSpy,
}));

import { BriefService, type GenerateResult } from '../src/modules/brief/service.js';
import { PerKeyCooldown } from '../src/platform/cooldown.js';
import { AppError, NotFoundError } from '../src/platform/errors.js';

const WS = 'ws';
const PR_ID = 'pr1';

const pull = (over: Record<string, unknown> = {}) => ({
  id: PR_ID,
  workspaceId: WS,
  repoId: 'repo1',
  title: 'Add thing',
  body: 'b',
  headSha: 'sha-1',
  ...over,
});

const stored = (sha = 'sha-1') => ({
  summary: 'S',
  intent: null,
  blast: null,
  risks: { risks: [] },
  review_focus: [],
  meta: {
    generated_from_head_sha: sha,
    generated_at: '2026-10-01T00:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4.1',
    schema_attempts: 1,
    tokens_in: 10,
    tokens_out: 5,
    cost_usd: null,
    missing: [],
    sources: [],
    diff_stats: null,
    input: { estimated_tokens: 100, budget_tokens: 8000, truncated: [], blast_degraded_reason: null },
    grounding: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0 },
  },
});

const okResult = (sha = 'sha-1') =>
  ({
    status: 'ok',
    outcome: 'ok',
    brief: stored(sha),
    meta: { prId: PR_ID, outcome: 'ok', calls: 1 },
  }) as unknown as GenerateResult;

const failedResult = {
  status: 'failed',
  outcome: 'provider_error',
  error: 'boom',
  meta: { prId: PR_ID, outcome: 'provider_error', calls: 1 },
} as unknown as GenerateResult;

function setup(
  over: {
    pull?: unknown;
    repo?: unknown;
    brief?: unknown;
    headSha?: string | undefined;
    clock?: { t: number };
  } = {},
) {
  const reads = {
    getPull: vi.fn(async () => ('pull' in over ? over.pull : pull()) as never),
    getRepo: vi.fn(async () => ('repo' in over ? over.repo : { id: 'repo1', owner: 'o', name: 'r' }) as never),
    getBrief: vi.fn(async () => over.brief),
    getHeadSha: vi.fn(async () => ('headSha' in over ? over.headSha : 'sha-1')),
  };
  const clock = over.clock;
  const cooldown = new PerKeyCooldown(30_000, clock ? () => clock.t : undefined);
  const service = new BriefService({ db: {} } as never, { reads, cooldown });
  const log = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
  return { service, reads, cooldown, log, logArg: log as never };
}

afterEach(() => {
  hoisted.logSpy.mockClear();
  vi.restoreAllMocks();
});

describe('BriefService.get', () => {
  it('404 when the PR does not exist', async () => {
    const s = setup({ pull: undefined });
    await expect(s.service.get(WS, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
    expect(s.reads.getBrief).not.toHaveBeenCalled();
  });

  it('403 for a PR in another workspace; the brief is never read', async () => {
    const s = setup({ pull: pull({ workspaceId: 'other' }), brief: stored() });
    const err = await s.service.get(WS, PR_ID).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 403 });
    expect(s.reads.getBrief).not.toHaveBeenCalled();
  });

  it('404 when no brief is stored', async () => {
    const s = setup();
    await expect(s.service.get(WS, PR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404 plus a warn log when the stored JSON does not parse', async () => {
    const s = setup({ brief: { summary: 42 } });
    await expect(s.service.get(WS, PR_ID, s.logArg)).rejects.toBeInstanceOf(NotFoundError);
    expect(s.log.warn).toHaveBeenCalledTimes(1);
  });

  it('returns the brief with pr_id; stale follows the current head SHA', async () => {
    const fresh = setup({ brief: stored('sha-1') });
    expect(await fresh.service.get(WS, PR_ID)).toMatchObject({ pr_id: PR_ID, stale: false, summary: 'S' });

    const stale = setup({ brief: stored('sha-1'), pull: pull({ headSha: 'sha-2' }) });
    expect((await stale.service.get(WS, PR_ID)).stale).toBe(true);
  });
});

describe('BriefService.generateForPr', () => {
  it('404 / 403 / missing repo come before admission (the cooldown is untouched)', async () => {
    const admit = (s: ReturnType<typeof setup>) => vi.spyOn(s.cooldown, 'admit');

    const none = setup({ pull: undefined });
    const a = admit(none);
    await expect(none.service.generateForPr(WS, PR_ID, none.logArg)).rejects.toBeInstanceOf(NotFoundError);

    const other = setup({ pull: pull({ workspaceId: 'other' }) });
    const b = admit(other);
    await expect(other.service.generateForPr(WS, PR_ID, other.logArg)).rejects.toMatchObject({ statusCode: 403 });

    const noRepo = setup({ repo: undefined });
    const c = admit(noRepo);
    await expect(noRepo.service.generateForPr(WS, PR_ID, noRepo.logArg)).rejects.toMatchObject({
      message: 'Repo not found',
    });

    for (const spy of [a, b, c]) expect(spy).not.toHaveBeenCalled();
    expect(hoisted.logSpy).not.toHaveBeenCalled();
  });

  it('ok: logs once, returns the brief, stale from the re-read head SHA', async () => {
    const s = setup({ headSha: 'sha-2' });
    vi.spyOn(s.service, 'generate').mockResolvedValue(okResult('sha-1'));
    const out = await s.service.generateForPr(WS, PR_ID, s.logArg);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.brief).toMatchObject({ pr_id: PR_ID, stale: true });
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
  });

  it('ok: stale false when the head SHA is unchanged; falls back to the PR sha if the row vanished', async () => {
    const same = setup();
    vi.spyOn(same.service, 'generate').mockResolvedValue(okResult('sha-1'));
    const a = await same.service.generateForPr(WS, PR_ID, same.logArg);
    expect(a.kind === 'ok' && a.brief.stale).toBe(false);

    const gone = setup({ headSha: undefined });
    vi.spyOn(gone.service, 'generate').mockResolvedValue(okResult('sha-1'));
    const b = await gone.service.generateForPr(WS, PR_ID, gone.logArg);
    expect(b.kind === 'ok' && b.brief.stale).toBe(false);
  });

  it('ok: a failing head SHA re-read still returns the stored brief, stale from the PR sha', async () => {
    const s = setup();
    s.reads.getHeadSha.mockRejectedValue(new Error('db down'));
    vi.spyOn(s.service, 'generate').mockResolvedValue(okResult('sha-0'));
    const out = await s.service.generateForPr(WS, PR_ID, s.logArg);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.brief).toMatchObject({ pr_id: PR_ID, stale: true });
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
  });

  it('rate_limited: a second request within the window; no generation, no log line, warn once', async () => {
    const clock = { t: 1_000_000 };
    const s = setup({ clock });
    const gen = vi.spyOn(s.service, 'generate').mockResolvedValue(okResult());
    await s.service.generateForPr(WS, PR_ID, s.logArg);
    hoisted.logSpy.mockClear();

    clock.t += 10_000;
    const out = await s.service.generateForPr(WS, PR_ID, s.logArg);
    expect(out).toEqual({ kind: 'rate_limited', retryAfter: 20 });
    expect(gen).toHaveBeenCalledTimes(1);
    expect(hoisted.logSpy).not.toHaveBeenCalled();
    expect(s.log.warn).toHaveBeenCalledTimes(1);
  });

  it('failed: returns the fixed error and retryAfter, logs once, counts toward the limit', async () => {
    const clock = { t: 1_000_000 };
    const s = setup({ clock });
    // The failure takes 4.5 s: 25.5 s of the window remain -> 26.
    vi.spyOn(s.service, 'generate').mockImplementation(async () => {
      clock.t += 4_500;
      return failedResult;
    });
    const out = await s.service.generateForPr(WS, PR_ID, s.logArg);
    expect(out).toEqual({ kind: 'failed', error: 'boom', retryAfter: 26 });
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
    expect((await s.service.generateForPr(WS, PR_ID, s.logArg)).kind).toBe('rate_limited');
  });

  it('unexpected throw: logs exactly one provider_error line, rethrows, releases in-flight', async () => {
    const clock = { t: 0 };
    const cooldown = new PerKeyCooldown(30_000, () => clock.t);
    const s = setup();
    const service = new BriefService({ db: {} } as never, { reads: s.reads, cooldown });
    const gen = vi.spyOn(service, 'generate').mockRejectedValueOnce(new Error('kaboom'));

    await expect(service.generateForPr(WS, PR_ID, s.logArg)).rejects.toThrow('kaboom');
    expect(hoisted.logSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.logSpy.mock.calls[0]![1]).toMatchObject({
      prId: PR_ID,
      outcome: 'provider_error',
      calls: 0,
    });

    // Released: once the window has passed, the next request is admitted.
    clock.t += 31_000;
    gen.mockResolvedValueOnce(okResult());
    expect((await service.generateForPr(WS, PR_ID, s.logArg)).kind).toBe('ok');
  });
});
