import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { CiRepository } from '../src/modules/ci/repository.js';
import { CiService } from '../src/modules/ci/service.js';
import { syncWorkspace } from '../src/modules/ci/sync.js';
import type { ActionsRun, CiActionsSource } from '../src/modules/ci/ports.js';
import AdmZip from 'adm-zip';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci] Docker not available - skipping integration tests.');
}

const SHA = 'e'.repeat(40);
const log = { info: () => {}, warn: () => {} };

d('export to CI (DB)', () => {
  let pg: PgFixture;
  let db: PgFixture['handle']['db'];
  let ws: string;
  let agentId: string;
  let otherAgentId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    db = pg.handle.db;
    [{ id: ws }] = (await db.insert(t.workspaces).values({ name: 'ci-it' }).returning()) as [{ id: string }];
    const mk = async (name: string) =>
      (
        await db
          .insert(t.agents)
          .values({ workspaceId: ws, name, provider: 'openrouter', model: 'm/x', systemPrompt: 'p', version: 2 })
          .returning()
      )[0]!.id;
    agentId = await mk('Secret Gate');
    otherAgentId = await mk('Other Bot');
    [{ id: repoId }] = (await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name: 'widgets', fullName: 'acme/widgets', defaultBranch: 'develop' })
      .returning()) as [{ id: string }];
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const service = (github = new MockGitHubClient(), repoGithubId = 999) =>
    new CiService({
      repo: new CiRepository(db),
      github: async () => github,
      actions: async () => ({
        getRepoId: async () => repoGithubId,
        listCompletedRuns: async () => [],
        downloadResultArtifact: async () => null,
      }),
      runnerPath: '/x',
      readFile: async () => 'runner',
      log,
    });
  const input = (over: Record<string, unknown> = {}) =>
    ({ repo: 'acme/widgets', target: 'gha', action: 'open_pr', post_as: 'github_review', triggers: ['opened'], base: 'main', ...over }) as never;
  const installations = () => db.select().from(t.ciInstallations);

  it('AC-48 installation row after open_pr, reused PR, zip (pr_url null, github_repo_id null); AC-19 stored workflow_version', async () => {
    const github = new MockGitHubClient();
    const out = await service(github).export(ws, agentId, input());
    const [row] = await installations();
    expect(row).toMatchObject({
      agentId,
      repo: 'acme/widgets',
      targetType: 'gha',
      repoId,
      githubRepoId: 999,
      slug: 'secret-gate',
      workflowVersion: 1,
      agentVersion: 2,
      ciFailOn: 'critical',
      postAs: 'github_review',
      triggers: ['opened'],
      prUrl: out.pr_url,
    });
    expect(row!.files).toContain('.github/workflows/devdigest-review-secret-gate.yml');
    expect(row!.workflowFile).toBe('devdigest-review-secret-gate.yml');
    expect(github.committed[0]!.base).toBe('develop');

    // re-export: same row (one per repository and agent), PR reused
    await service(github).export(ws, agentId, input({ triggers: ['opened', 'reopened'] }));
    const rows = await installations();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.triggers).toEqual(['opened', 'reopened']);
    expect(github.openedPrs).toHaveLength(1);

    // zip path on the same installation: pr_url null, existing github_repo_id kept
    await service().export(ws, agentId, input({ action: 'files' }));
    const [zipRow] = await installations();
    expect(zipRow!.prUrl).toBeNull();
    expect(zipRow!.githubRepoId).toBe(999);
  });

  it('AC-8 (revision 2) many agents per repo: a second agent gets its own row, workflow and manifest', async () => {
    const github = new MockGitHubClient();
    await service(github).export(ws, otherAgentId, input());
    const rows = await installations();
    expect(rows.filter((r) => r.repo === 'acme/widgets').map((r) => r.agentId).sort()).toEqual([agentId, otherAgentId].sort());
    const other = rows.find((r) => r.agentId === otherAgentId)!;
    expect(other.workflowFile).toBe('devdigest-review-other-bot.yml');
    expect(other.files).toContain('.devdigest/agents/other-bot.yaml');
    // re-export updates the same row, no second one
    await service(github).export(ws, otherAgentId, input({ triggers: ['reopened'] }));
    const again = (await installations()).filter((r) => r.agentId === otherAgentId);
    expect(again).toHaveLength(1);
    expect(again[0]!.triggers).toEqual(['reopened']);
  });

  it('unique (repo, agent_id): a duplicate row for the same repo and agent is rejected', async () => {
    await expect(
      db.insert(t.ciInstallations).values({ agentId: otherAgentId, repo: 'acme/widgets', targetType: 'gha' }),
    ).rejects.toThrow();
  });

  it('a LEGACY installation (workflow_file null) of another agent is regenerated in the same commit; re-export keeps the legacy path', async () => {
    await db.update(t.ciInstallations).set({ workflowFile: null }).where(eq(t.ciInstallations.agentId, agentId));
    await db.delete(t.ciInstallations).where(eq(t.ciInstallations.agentId, otherAgentId));
    const github = new MockGitHubClient();
    await service(github).export(ws, otherAgentId, input());
    const paths = github.committed[0]!.files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['.github/workflows/devdigest-review.yml', '.github/workflows/devdigest-review-other-bot.yml']));
    expect(github.committed[0]!.files.find((f) => f.path === '.github/workflows/devdigest-review.yml')!.contents).toContain('DEVDIGEST_AGENT: secret-gate');

    // the legacy agent re-exports: still the legacy path, still a null workflow_file
    const g2 = new MockGitHubClient();
    await service(g2).export(ws, agentId, input());
    expect(g2.committed[0]!.files.map((f) => f.path)).toContain('.github/workflows/devdigest-review.yml');
    const legacy = (await installations()).find((r) => r.agentId === agentId)!;
    expect(legacy.workflowFile).toBeNull();

    // restore the shared fixture for the sync tests: one per-agent installation
    await db.delete(t.ciInstallations).where(eq(t.ciInstallations.agentId, otherAgentId));
    await db.update(t.ciInstallations).set({ workflowFile: 'devdigest-review-secret-gate.yml' }).where(eq(t.ciInstallations.agentId, agentId));
  });

  describe('sync and ingest', () => {
    const run = (id: number, over: Partial<ActionsRun> = {}): ActionsRun => ({
      id,
      head_sha: SHA,
      repository_id: 999,
      pull_requests: [42],
      display_title: `run ${id}`,
      html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
      ran_at: new Date(Date.UTC(2026, 2, 1, 0, 0, id)).toISOString(),
      conclusion: 'success',
      ...over,
    });
    const artifactZip = (prNumber = 42) => {
      const z = new AdmZip();
      z.addFile(
        'devdigest-result.json',
        Buffer.from(
          JSON.stringify({
            findings_count: 2, critical: 1, warning: 1, suggestion: 0, cost_usd: 0.02, duration_ms: 3000,
            agent: 'Secret Gate', version: '2', pr_number: prNumber, commit_sha: SHA, repository_id: 999,
            model: 'm/x', agent_version: 2, verdict: 'REQUEST_CHANGES', blockers: 1,
          }),
        ),
      );
      return z.toBuffer();
    };
    const actions = (runs: ActionsRun[], withArtifact: (id: number) => boolean): CiActionsSource => ({
      getRepoId: async () => 999,
      listCompletedRuns: async () => runs,
      downloadResultArtifact: async (_r, id) => (withArtifact(id) ? artifactZip() : null),
    });
    const sync = (a: CiActionsSource) => syncWorkspace({ repo: new CiRepository(db), actions: a, log }, ws);

    it('AC-64 agent_runs source=ci with agent, workspace, model, duration, cost, counts, blockers; AC-65 ci_runs fields + agent_run link; failed run has no agent_run', async () => {
      const [pr] = await db
        .insert(t.pullRequests)
        .values({ workspaceId: ws, repoId, number: 42, title: 'PR', author: 'a', branch: 'f', base: 'develop', headSha: SHA })
        .returning();
      const res = await sync(actions([run(1), run(2)], (id) => id === 1));
      expect(res).toMatchObject({ seen: 2, ingested: 1, rejected: 0, failures: [] });

      const good = (await db.select().from(t.ciRuns).where(eq(t.ciRuns.githubRunId, 1)))[0]!;
      expect(good).toMatchObject({
        workspaceId: ws, agentId, agentName: 'Secret Gate', repo: 'acme/widgets', prNumber: 42,
        commitSha: SHA, status: 'succeeded', findingsCount: 2, critical: 1, warning: 1, suggestion: 0,
        verdict: 'REQUEST_CHANGES', durationMs: 3000, costUsd: 0.02, model: 'm/x', agentVersion: 2,
        runnerVersion: '2', workflowVersion: 1, source: 'ci',
      });
      expect(good.agentRunId).not.toBeNull();
      const [ar] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, good.agentRunId!));
      expect(ar).toMatchObject({
        workspaceId: ws, agentId, prId: pr!.id, source: 'ci', status: 'done', model: 'm/x',
        durationMs: 3000, costUsd: 0.02, findingsCount: 2, blockers: 1,
        severityCounts: { critical: 1, warning: 1, suggestion: 0 },
      });

      const failed = (await db.select().from(t.ciRuns).where(eq(t.ciRuns.githubRunId, 2)))[0]!;
      expect(failed).toMatchObject({ status: 'failed', agentRunId: null });
      expect(failed.reason).toMatch(/^No result artifact/);
    });

    it('AC-64 prId is null for a PR that was not imported', async () => {
      await sync({
        getRepoId: async () => 999,
        listCompletedRuns: async () => [run(3, { pull_requests: [77] })],
        downloadResultArtifact: async () => artifactZip(77),
      });
      const ci = (await db.select().from(t.ciRuns).where(eq(t.ciRuns.githubRunId, 3)))[0]!;
      const [ar] = await db.select().from(t.agentRuns).where(eq(t.agentRuns.id, ci.agentRunId!));
      expect(ar).toMatchObject({ source: 'ci', prId: null });
    });

    it('AC-67 two concurrent syncs -> one row per github_run_id, one agent_runs row', async () => {
      const before = (await db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'))).length;
      const a = actions([run(10)], () => true);
      await Promise.all([sync(a), sync(a)]);
      const rows = await db.select().from(t.ciRuns).where(eq(t.ciRuns.githubRunId, 10));
      expect(rows).toHaveLength(1);
      const after = (await db.select().from(t.agentRuns).where(eq(t.agentRuns.source, 'ci'))).length;
      expect(after - before).toBe(1);
    });

    it('AC-72 /ci/runs returns at most 100, newest first', async () => {
      const runs = Array.from({ length: 110 }, (_, i) => run(1000 + i));
      await sync(actions(runs, () => false));
      const list = await new CiRepository(db).listRuns(ws, 100);
      expect(list).toHaveLength(100);
      const times = list.map((r) => r.ranAt!.getTime());
      expect(times).toEqual([...times].sort((x, y) => y - x));
      const view = await service().listRuns(ws);
      expect(view.runs).toHaveLength(100);
      expect(view.installations_count).toBe(1);
    });

    it('agent delete keeps ci_runs (installation link null)', async () => {
      const [inst] = await installations();
      const before = await db.select().from(t.ciRuns).where(eq(t.ciRuns.ciInstallationId, inst!.id));
      expect(before.length).toBeGreaterThan(0);
      await db.delete(t.agents).where(eq(t.agents.id, agentId));
      const kept = await db.select().from(t.ciRuns).where(eq(t.ciRuns.workspaceId, ws));
      expect(kept.length).toBeGreaterThanOrEqual(before.length);
      expect(kept.every((r) => r.agentId === null)).toBe(true);
      expect(kept.every((r) => r.ciInstallationId === null)).toBe(true);
    });
  });
});
