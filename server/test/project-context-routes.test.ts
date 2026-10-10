/**
 * Project-context routes via app.inject(). The repository's data access is replaced by an
 * in-memory store (prototype spies); the source is MockProjectDocsSource with call spies.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import { ProjectContextRepository } from '../src/modules/project-context/repository.js';
import {
  AGENT_ID,
  OTHER_WS,
  REPO_ID,
  SKILL_ID,
  WS,
  seedStore,
  type FakeProjectContextStore,
} from './helpers/project-context-store.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const tokenizer = { count: (t: string) => t.length };

let closeApp: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

const METHODS = [
  'findRepo',
  'findAgent',
  'findSkill',
  'latestRepoId',
  'workspaceUsage',
  'linkedSkillsWithPaths',
  'setAgentPaths',
  'setSkillPaths',
] as const;

let store: FakeProjectContextStore;
beforeEach(() => {
  store = seedStore();
});

async function setup(
  opts: { store?: FakeProjectContextStore; source?: MockProjectDocsSource } = {},
) {
  const s = opts.store ?? store;
  for (const m of METHODS) {
    vi.spyOn(ProjectContextRepository.prototype, m).mockImplementation(((...a: unknown[]) =>
      (s[m] as (...x: unknown[]) => unknown)(...a)) as never);
  }
  const source =
    opts.source ??
    new MockProjectDocsSource({
      heads: { main: 'sha-main' },
      files: { 'sha-main': { 'docs/own.md': 'hello', 'specs/skill.md': 'sk', 'docs/bin.md': new Uint8Array([0xff]) } },
    });
  const app = await buildApp({
    config,
    db: {} as Db,
    overrides: { auth: fakeAuth as never, projectDocs: source, tokenizer },
  });
  closeApp = () => app.close();
  return { app, source };
}

describe('project-context routes', () => {
  it('GET /context/default-repo', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/context/default-repo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ repo_id: REPO_ID });
  });

  it('GET docs lists the docs; refresh=1 accepted', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context/docs?refresh=1` });
    expect(res.statusCode).toBe(200);
    expect(res.json().docs.map((d: { path: string }) => d.path)).toEqual([
      'docs/bin.md',
      'docs/own.md',
      'specs/skill.md',
    ]);
  });

  it('discovery 502 leaves agent rows unchanged', async () => {
    const before = JSON.stringify([...store.agents.values()]);
    const { app } = await setup({ source: new MockProjectDocsSource({ headError: new Error('token ghp_SECRET') }) });
    const res = await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context/docs` });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('discovery_failed');
    expect(JSON.stringify(res.json())).not.toContain('ghp_SECRET');
    expect(JSON.stringify([...store.agents.values()])).toBe(before);
    expect(store.writes).toHaveLength(0);
  });

  it('PUT duplicate (incl. ./ form) -> 400, row unchanged', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${AGENT_ID}/context`,
      payload: { paths: ['docs/a.md', './docs/a.md'] },
    });
    expect(res.statusCode).toBe(400);
    expect(store.agents.get(AGENT_ID)!.contextPaths).toEqual(['docs/own.md']);
  });

  it('PUT invalid path -> 400', async () => {
    const { app } = await setup();
    for (const url of [`/agents/${AGENT_ID}/context`, `/skills/${SKILL_ID}/context`]) {
      const res = await app.inject({ method: 'PUT', url, payload: { paths: ['../secrets.md'] } });
      expect(res.statusCode).toBe(400);
    }
    expect(store.writes).toHaveLength(0);
  });

  it('PUT beyond the limits -> 400 on agent and skill routes, row unchanged', async () => {
    const { app } = await setup();
    const fifty = Array.from({ length: 50 }, (_, i) => `docs/d${i}.md`);
    const tooMany = [...fifty, 'docs/d50.md'];
    const longPath = `docs/${'a'.repeat(296)}.md`; // 301 chars
    for (const url of [`/agents/${AGENT_ID}/context`, `/skills/${SKILL_ID}/context`]) {
      const many = await app.inject({ method: 'PUT', url, payload: { paths: tooMany } });
      expect(many.statusCode, `${url} 51 paths`).toBe(400);
      const long = await app.inject({ method: 'PUT', url, payload: { paths: [longPath] } });
      expect(long.statusCode, `${url} long path`).toBe(400);
      const ok = await app.inject({ method: 'PUT', url, payload: { paths: fifty } });
      expect(ok.statusCode, `${url} 50 paths`).toBe(200);
    }
  });

  it('PUT skill duplicate (incl. ./ form) -> 400, row unchanged', async () => {
    const { app } = await setup();
    const before = [...store.skills.get(SKILL_ID)!.contextPaths];
    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${SKILL_ID}/context`,
      payload: { paths: ['docs/a.md', './docs/a.md'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code ?? res.json().error).toBeTruthy();
    expect(store.skills.get(SKILL_ID)!.contextPaths).toEqual(before);
    expect(store.writes).toHaveLength(0);
  });

  it('PUT persists full ordered list', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${AGENT_ID}/context`,
      payload: { paths: ['specs/z.md', 'docs/a.md', 'insights/m.md'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths).toEqual(['specs/z.md', 'docs/a.md', 'insights/m.md']);
    const get = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/context` });
    expect(get.json()).toMatchObject({
      paths: ['specs/z.md', 'docs/a.md', 'insights/m.md'],
      version: 2,
      inherited: [{ path: 'specs/skill.md', skill_id: SKILL_ID, skill_name: 'Security' }],
    });
    const sk = await app.inject({ method: 'PUT', url: `/skills/${SKILL_ID}/context`, payload: { paths: ['docs/s.md'] } });
    expect(sk.json()).toEqual({ paths: ['docs/s.md'], version: 2 });
    expect((await app.inject({ method: 'GET', url: `/skills/${SKILL_ID}/context` })).json().paths).toEqual(['docs/s.md']);
  });

  it('other-workspace agent/skill/repo -> 403, unknown id -> 404, zero source calls', async () => {
    const foreign = seedStore({ repoWs: OTHER_WS, agentWs: OTHER_WS, skillWs: OTHER_WS });
    const { app, source } = await setup({ store: foreign });
    const calls: [string, string, unknown?][] = [
      ['GET', `/repos/${REPO_ID}/context/docs`],
      ['GET', `/repos/${REPO_ID}/context/docs/preview?path=docs/own.md`],
      ['GET', `/agents/${AGENT_ID}/context`],
      ['PUT', `/agents/${AGENT_ID}/context`, { paths: [] }],
      ['GET', `/skills/${SKILL_ID}/context`],
      ['PUT', `/skills/${SKILL_ID}/context`, { paths: [] }],
    ];
    for (const [method, url, payload] of calls) {
      const res = await app.inject({ method: method as 'GET', url, ...(payload ? { payload: payload as object } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    for (const url of [
      `/repos/${UNKNOWN}/context/docs`,
      `/repos/${UNKNOWN}/context/docs/preview?path=docs/own.md`,
      `/agents/${UNKNOWN}/context`,
      `/skills/${UNKNOWN}/context`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    }
    expect(source.calls).toHaveLength(0);
    expect(foreign.writes).toHaveLength(0);
  });

  it('preview ../../.env, /etc/passwd, src/index.ts -> 400, zero reads', async () => {
    const { app, source } = await setup();
    for (const p of ['../../.env', '/etc/passwd', 'src/index.ts']) {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/${REPO_ID}/context/docs/preview?path=${encodeURIComponent(p)}`,
      });
      expect(res.statusCode, p).toBe(400);
    }
    expect(source.calls).toHaveLength(0);
  });

  it('preview: other-workspace repo + invalid path -> 403, unknown repo + invalid path -> 404, zero source calls', async () => {
    const foreign = seedStore({ repoWs: OTHER_WS, agentWs: OTHER_WS, skillWs: OTHER_WS });
    const { app, source } = await setup({ store: foreign });
    for (const p of ['../../.env', '/etc/passwd', 'src/index.ts']) {
      const q = `?path=${encodeURIComponent(p)}`;
      expect((await app.inject({ method: 'GET', url: `/repos/${REPO_ID}/context/docs/preview${q}` })).statusCode, p).toBe(403);
      expect((await app.inject({ method: 'GET', url: `/repos/${UNKNOWN}/context/docs/preview${q}` })).statusCode, p).toBe(404);
    }
    expect(source.calls).toHaveLength(0);
  });

  it('preview: 200 with content, 404 not_on_main, 422 not_text', async () => {
    const { app } = await setup();
    const url = (p: string) => `/repos/${REPO_ID}/context/docs/preview?path=${encodeURIComponent(p)}`;
    const ok = await app.inject({ method: 'GET', url: url('docs/own.md') });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ content: 'hello', tokens: 5, used_by: 1, commit_sha: 'sha-main' });
    const gone = await app.inject({ method: 'GET', url: url('docs/gone.md') });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().code).toBe('not_on_main');
    const bin = await app.inject({ method: 'GET', url: url('docs/bin.md') });
    expect(bin.statusCode).toBe(422);
    expect(bin.json().code).toBe('not_text');
  });
});
