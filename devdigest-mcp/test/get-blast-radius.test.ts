import { describe, it, expect, vi } from 'vitest';
import { getBlastRadius, TOOL_CONFIG, TOOL_NAME } from '../src/tools/get-blast-radius.js';
import { createServer } from '../src/server.js';

const PR = '33333333-3333-4333-8333-333333333333';
const asFetch = (fn: unknown) => fn as typeof fetch;
const call = (f: unknown) => getBlastRadius({ pr_id: PR }, { baseUrl: 'http://api', fetchImpl: asFetch(f) });
const respond = (status: number, body = '{}') =>
  vi.fn(async () => new Response(body, { status }));

describe('get_blast_radius', () => {
  it('GETs /pulls/:id/blast and returns the body as compact JSON text', async () => {
    const body = { changed_symbols: [], downstream: [], summary: 's', degraded: false, reason: null };
    const f = respond(200, JSON.stringify(body));
    const res = await call(f);
    expect(f).toHaveBeenCalledWith(`http://api/pulls/${PR}/blast`, expect.anything());
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toBe(JSON.stringify(body));
    expect(res.content[0]!.text).not.toContain('\n');
  });

  it('404 -> tells the agent the PR is unknown and which id to use', async () => {
    const res = await call(respond(404, '{"error":"PR not found"}'));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain(`PR ${PR} not found in DevDigest`);
    expect(res.content[0]!.text).toContain('GitHub PR number');
  });

  it('403 -> access denied message', async () => {
    const res = await call(respond(403));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('another workspace');
  });

  it('422 -> invalid uuid message', async () => {
    const res = await call(respond(422));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('valid uuid');
  });

  it('other HTTP errors keep status and detail', async () => {
    const res = await call(respond(500, 'boom'));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('HTTP 500: boom');
  });

  it('network failure -> says the API is unreachable and where', async () => {
    const f = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const res = await call(f);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('unreachable at http://api');
    expect(res.content[0]!.text).toContain('ECONNREFUSED');
  });

  it('is declared read-only, describes when to call it and validates the id as uuid', () => {
    expect(TOOL_CONFIG.annotations.readOnlyHint).toBe(true);
    expect(TOOL_CONFIG.description).toMatch(/call it when/i);
    expect(TOOL_CONFIG.inputSchema.pr_id.safeParse('nope').success).toBe(false);
    expect(TOOL_CONFIG.inputSchema.pr_id.safeParse(PR).success).toBe(true);
    expect(TOOL_CONFIG.inputSchema.number.safeParse(0).success).toBe(false);
    expect(TOOL_CONFIG.inputSchema.repo.safeParse('no-slash').success).toBe(false);
  });

  it('createServer registers the tool under its name', () => {
    const server = createServer() as unknown as { _registeredTools: Record<string, unknown> };
    expect(Object.keys(server._registeredTools)).toEqual([TOOL_NAME]);
  });
});

describe('get_blast_radius: repo + number', () => {
  const REPO_ID = '44444444-4444-4444-8444-444444444444';
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const router = (blast: unknown = { ok: true }) =>
    vi.fn(async (url: string) => {
      if (url.endsWith('/repos')) return json([{ id: REPO_ID, full_name: 'ochubey/dev-digest-learning' }]);
      if (url.endsWith(`/repos/${REPO_ID}/pulls`)) return json([{ id: PR, number: 14 }, { id: 'x', number: 3 }]);
      if (url.endsWith(`/pulls/${PR}/blast`)) return json(blast);
      return new Response('{}', { status: 404 });
    });
  const run = (args: Record<string, unknown>, f: unknown) =>
    getBlastRadius(args, { baseUrl: 'http://api', fetchImpl: asFetch(f) });

  it('resolves the PR id from repo + number, case-insensitively, then returns the same blast body', async () => {
    const f = router({ summary: 's' });
    const res = await run({ repo: 'OchuBey/Dev-Digest-Learning', number: 14 }, f);
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0]!.text)).toEqual({ summary: 's' });
    expect(f).toHaveBeenLastCalledWith(`http://api/pulls/${PR}/blast`, expect.anything());
  });

  it('pr_id wins and no lookup happens', async () => {
    const f = router();
    await run({ pr_id: PR, repo: 'a/b', number: 1 }, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('unknown repo lists the known ones', async () => {
    const res = await run({ repo: 'a/b', number: 1 }, router());
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Known repos: ochubey/dev-digest-learning');
  });

  it('unknown PR number says which repo was searched', async () => {
    const res = await run({ repo: 'ochubey/dev-digest-learning', number: 999 }, router());
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('PR #999 was not found in ochubey/dev-digest-learning');
  });

  it('asks for pr_id or repo + number when neither is given', async () => {
    const res = await run({ repo: 'ochubey/dev-digest-learning' }, router());
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Provide `pr_id`, or `repo`');
  });
});

