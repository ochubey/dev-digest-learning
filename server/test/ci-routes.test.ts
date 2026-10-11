/**
 * CI routes via app.inject(). CiRepository is replaced by an in-memory fake (prototype spies),
 * GitHub by MockGitHubClient, GitHub Actions reads by OctokitActionsSource.prototype spies.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { OctokitActionsSource } from '../src/adapters/github-actions/octokit.js';
import { generateWorkflow } from '../src/modules/ci/workflow.js';
import { FakeCiRepo, WS, AGENT_ID, installationRow } from './helpers/ci-store.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: ((p: unknown, ...rest: unknown[]) =>
      String(p).endsWith('agent-runner/dist/index.js')
        ? Promise.resolve('console.log("runner")')
        : (actual.readFile as (...a: unknown[]) => unknown)(p, ...rest)) as typeof actual.readFile,
  };
});

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const secrets = { get: async (k: string) => (k === 'GITHUB_TOKEN' ? 'ghp_FAKE' : null) };

const METHODS = [
  'findAgent',
  'findRepoByFullName',
  'enabledLinkedSkills',
  'repoMemory',
  'installationByRepo',
  'upsertInstallation',
  'installationsForAgent',
  'installationsForSync',
  'setGithubRepoId',
  'existingRunIds',
  'findImportedPr',
  'insertRun',
  'listRuns',
  'listAgentRuns',
  'lastRunPerInstallation',
  'countInstallations',
] as const;

let closeApp: (() => Promise<void>) | null = null;
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

let store: FakeCiRepo;
let github: MockGitHubClient;
beforeEach(() => {
  store = new FakeCiRepo();
  github = new MockGitHubClient();
});

async function setup() {
  for (const m of METHODS) {
    vi.spyOn(CiRepository.prototype, m).mockImplementation(((...a: unknown[]) =>
      (store[m] as (...x: unknown[]) => unknown)(...a)) as never);
  }
  const app = await buildApp({
    config,
    db: {} as Db,
    overrides: { auth: fakeAuth as never, github, secrets: secrets as never },
  });
  closeApp = () => app.close();
  return app;
}

const body = (over: Record<string, unknown> = {}) => ({
  repo: 'acme/widgets',
  action: 'open_pr',
  post_as: 'github_review',
  triggers: ['opened', 'synchronize'],
  ...over,
});

describe('ci routes', () => {
  it('POST /agents/:id/export-ci/preview -> 200 with the runner emptied', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci/preview`, payload: body() });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.slug).toBe('secret-gate');
    expect(json.workflow_version).toBe(1);
    const runner = json.files.find((f: { path: string }) => f.path === '.devdigest/runner/index.js');
    expect(runner.contents).toBe('');
    expect(runner.size_bytes).toBeGreaterThan(0);
    expect(github.committed).toHaveLength(0);
  });

  it('preview 409 ci_repo_taken body shape', async () => {
    const app = await setup();
    store.installation = { ...installationRow({ agentId: '99999999-9999-4999-8999-999999999999' }), agentName: 'Other' };
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci/preview`, payload: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: 'ci_repo_taken',
        message: 'acme/widgets already runs agent Other in CI; one agent per repository is supported',
      },
    });
  });

  it('export open_pr -> 200 with pr_url and a recorded commit', async () => {
    const app = await setup();
    vi.spyOn(OctokitActionsSource.prototype, 'getRepoId').mockResolvedValue(999);
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: body() });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(github.committed[0]!.branch).toBe('devdigest/ci');
    expect(store.upserts).toHaveLength(1);
  });

  it('export files -> zip_base64 and filename, no GitHub write', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: body({ action: 'files' }) });
    expect(res.statusCode).toBe(200);
    expect(res.json().zip_filename).toBe('devdigest-ci-widgets.zip');
    expect(res.json().pr_url).toBeNull();
    expect(res.json().zip_base64.length).toBeGreaterThan(100);
    expect(github.committed).toHaveLength(0);
  });

  it('export ci_workflow_unsafe -> 400 with details.rule', async () => {
    const app = await setup();
    const workflow = generateWorkflow({ triggers: ['opened'], postAs: 'none' }).replace('pull_request:', 'pull_request_target:');
    const res = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: body({ workflow }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ci_workflow_unsafe');
    expect(res.json().error.details).toEqual({ rule: 'forbidden_trigger' });
    expect(github.committed).toHaveLength(0);
    expect(store.upserts).toHaveLength(0);
  });

  it('export github errors keep their status and code (403 scope, 502 other)', async () => {
    const app = await setup();
    vi.spyOn(github, 'commitFiles').mockRejectedValueOnce(
      new Error('refusing to allow an OAuth App to create or update workflow without `workflow` scope'),
    );
    const scope = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: body() });
    expect(scope.statusCode).toBe(403);
    expect(scope.json().error.code).toBe('github_workflow_scope_missing');
    vi.spyOn(github, 'commitFiles').mockRejectedValueOnce(Object.assign(new Error('Bad gateway'), { status: 502 }));
    const other = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: body() });
    expect(other.statusCode).toBe(502);
    expect(other.json().error.code).toBe('github_error');
  });

  it('bad body shape -> 422; unknown agent -> 404; non-uuid id -> 422', async () => {
    const app = await setup();
    const bad = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci`, payload: { action: 'zip' } });
    expect(bad.statusCode).toBe(422);
    store.agent = undefined;
    const missing = await app.inject({ method: 'POST', url: `/agents/${AGENT_ID}/export-ci/preview`, payload: body() });
    expect(missing.statusCode).toBe(404);
    const badId = await app.inject({ method: 'POST', url: '/agents/not-a-uuid/export-ci/preview', payload: body() });
    expect(badId.statusCode).toBe(422);
  });

  it('GET /agents/:id/ci -> installations with config_changed; GET /ci/runs -> runs and count', async () => {
    const app = await setup();
    store.installation = { ...installationRow({ agentVersion: 1 }), agentName: 'Secret Gate' };
    store.count = 1;
    const ci = await app.inject({ method: 'GET', url: `/agents/${AGENT_ID}/ci` });
    expect(ci.statusCode).toBe(200);
    expect(ci.json().installations[0].config_changed).toBe(true);
    const runs = await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(runs.statusCode).toBe(200);
    expect(runs.json()).toEqual({ runs: [], installations_count: 1 });
  });

  it('POST /ci/sync with no body -> 200 CiSyncResult', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'POST', url: '/ci/sync' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ seen: 0, ingested: 0, rejected: 0, failures: [] });
  });

  it('AC-57: POST /ci/sync with an artifact payload -> 422 and no repository write', async () => {
    const app = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/ci/sync',
      payload: { findings_count: 99, agent: 'x', commit_sha: 'a'.repeat(40), repository_id: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(store.inserted).toHaveLength(0);
    expect(store.githubRepoIdSets).toHaveLength(0);
    expect(store.upserts).toHaveLength(0);
  });

  it('AC-57: no registered ci route accepts an artifact body (route list)', async () => {
    const app = await setup();
    const routes = app.printRoutes({ commonPrefix: false });
    for (const needle of ['/ci/sync', '/ci/runs', 'export-ci', '/agents/:id/ci']) {
      expect(routes, needle).toContain(needle.replace('/agents/:id/ci', 'ci'));
    }
    // Every route whose path mentions ci: only the five documented ones; nothing ingests a body.
    const ciPaths = [...routes.matchAll(/(GET|POST|PUT|PATCH|DELETE)[^\n]*/g)].map((m) => m[0]);
    const joined = ciPaths.join('\n');
    expect(joined).not.toMatch(/artifact|ingest|result/i);
    for (const verb of ['PUT', 'PATCH', 'DELETE']) {
      for (const p of ['/ci/sync', '/ci/runs']) {
        const res = await app.inject({ method: verb as 'PUT', url: p, payload: { findings_count: 1 } });
        expect(res.statusCode, `${verb} ${p}`).toBe(404);
      }
    }
    for (const p of ['/ci/artifact', '/ci/ingest', '/ci/result', '/ci/runs']) {
      const res = await app.inject({ method: 'POST', url: p, payload: { findings_count: 1, agent: 'x', cost_usd: null } });
      expect(res.statusCode, `POST ${p}`).toBe(404);
    }
    expect(store.inserted).toHaveLength(0);
  });
});
