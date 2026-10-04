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
    expect(res.content[0]!.text).toContain('not the GitHub PR number');
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
  });

  it('createServer registers the tool under its name', () => {
    const server = createServer() as unknown as { _registeredTools: Record<string, unknown> };
    expect(Object.keys(server._registeredTools)).toEqual([TOOL_NAME]);
  });
});
