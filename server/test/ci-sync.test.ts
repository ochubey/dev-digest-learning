import { describe, it, expect, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { syncWorkspace } from '../src/modules/ci/sync.js';
import type { ActionsRun, CiActionsSource } from '../src/modules/ci/ports.js';
import { ArtifactTooLargeError } from '../src/modules/ci/ports.js';
import { mapReadError } from '../src/modules/ci/github-errors.js';
import { FakeCiRepo, asRepo, syncInstallation } from './helpers/ci-store.js';

const SHA = 'c'.repeat(40);
const mkRun = (id: number, over: Partial<ActionsRun> = {}): ActionsRun => ({
  id,
  head_sha: SHA,
  repository_id: 999,
  pull_requests: [42],
  display_title: `run ${id}`,
  html_url: `https://github.com/acme/widgets/actions/runs/${id}`,
  ran_at: '2026-03-01T10:00:00Z',
  conclusion: 'success',
  ...over,
});
const goodJson = (over: Record<string, unknown> = {}) => ({
  findings_count: 2,
  critical: 1,
  warning: 1,
  suggestion: 0,
  cost_usd: 0.01,
  duration_ms: 1000,
  agent: 'Secret Gate',
  version: '2',
  pr_number: 42,
  commit_sha: SHA,
  repository_id: 999,
  model: 'm',
  agent_version: 3,
  verdict: 'REQUEST_CHANGES',
  blockers: 1,
  ...over,
});
const zipOf = (json: unknown, name = 'devdigest-result.json'): Uint8Array => {
  const z = new AdmZip();
  z.addFile(name, Buffer.from(JSON.stringify(json)));
  return z.toBuffer();
};

function setup(runs: ActionsRun[], artifacts: Record<number, Uint8Array | null | Error> = {}) {
  const repo = new FakeCiRepo();
  repo.syncInstallations = [syncInstallation()];
  const actions = {
    getRepoId: vi.fn(async () => 999),
    listCompletedRuns: vi.fn(async () => runs),
    downloadResultArtifact: vi.fn(async (_r: string, id: number) => {
      const a = artifacts[id];
      if (a instanceof Error) throw a;
      return a === undefined ? zipOf(goodJson()) : a;
    }),
  } satisfies CiActionsSource;
  const log = { info: vi.fn(), warn: vi.fn() };
  return { repo, actions, log, run: () => syncWorkspace({ repo: asRepo(repo), actions, log }, 'ws') };
}

describe('ci sync', () => {
  it('AC-56 lists <=30 completed runs per installation, ingests only unseen', async () => {
    const s = setup([mkRun(1), mkRun(2), mkRun(3)]);
    s.repo.knownRunIds.add(2);
    const res = await s.run();
    expect(s.actions.listCompletedRuns).toHaveBeenCalledWith('acme/widgets', 'devdigest-review.yml', 30);
    expect(res.seen).toBe(3);
    expect(res.ingested).toBe(2);
    expect(s.repo.inserted.map((i) => i.row.githubRunId)).toEqual([1, 3]);
    expect(s.actions.downloadResultArtifact).toHaveBeenCalledTimes(2);
    expect(res.failures).toEqual([]);
    expect(Date.parse(res.synced_at)).not.toBeNaN();
  });

  it('lists each installation by its own workflow file (null = legacy)', async () => {
    const s = setup([]);
    s.repo.syncInstallations = [
      syncInstallation({ id: 'i-legacy', agentId: 'a1', workflowFile: null }),
      syncInstallation({ id: 'i-new', agentId: 'a2', workflowFile: 'devdigest-review-perf-check.yml' }),
    ];
    await s.run();
    expect(s.actions.listCompletedRuns).toHaveBeenCalledWith('acme/widgets', 'devdigest-review.yml', 30);
    expect(s.actions.listCompletedRuns).toHaveBeenCalledWith('acme/widgets', 'devdigest-review-perf-check.yml', 30);
    expect(s.actions.listCompletedRuns).toHaveBeenCalledTimes(2);
  });

  it('a second sync of the same runs ingests nothing', async () => {
    const s = setup([mkRun(1)]);
    await s.run();
    const again = await s.run();
    expect(again.ingested).toBe(0);
    expect(s.repo.inserted).toHaveLength(1);
  });

  it('no installations -> empty result and no GitHub calls', async () => {
    const s = setup([mkRun(1)]);
    s.repo.syncInstallations = [];
    const res = await s.run();
    expect(res).toMatchObject({ seen: 0, ingested: 0, rejected: 0, failures: [] });
    expect(s.actions.listCompletedRuns).not.toHaveBeenCalled();
  });

  it('AC-60 null github_repo_id read from GitHub, stored, then used', async () => {
    const s = setup([mkRun(1)]);
    s.repo.syncInstallations = [syncInstallation({ githubRepoId: null })];
    const res = await s.run();
    expect(s.actions.getRepoId).toHaveBeenCalledWith('acme/widgets');
    expect(s.repo.githubRepoIdSets).toEqual([{ id: s.repo.syncInstallations[0]!.id, githubRepoId: 999 }]);
    // used for the cross-check: the artifact (999) matched
    expect(res.ingested).toBe(1);
  });

  it('AC-60 a stored github_repo_id is not re-read', async () => {
    const s = setup([]);
    await s.run();
    expect(s.actions.getRepoId).not.toHaveBeenCalled();
  });

  it('valid run -> ci_runs row + agent_runs payload linked to the imported PR (AC-64)', async () => {
    const s = setup([mkRun(1)]);
    s.repo.importedPr = 'pr-uuid';
    await s.run();
    const [{ row, agentRun }] = s.repo.inserted;
    expect(row.status).toBe('succeeded');
    expect(agentRun).toMatchObject({ source: 'ci', status: 'done', prId: 'pr-uuid', blockers: 1 });
  });

  it('valid run for a PR that is not imported -> prId null', async () => {
    const s = setup([mkRun(1)]);
    s.repo.importedPr = null;
    await s.run();
    expect(s.repo.inserted[0]!.agentRun!.prId).toBeNull();
  });

  it('AC-62 rejected -> failed row + warn log with installation, run id, rule and no artifact text', async () => {
    const SECRET_TEXT = 'ARTIFACT-BODY-DO-NOT-LOG';
    const s = setup([mkRun(1)], { 1: zipOf(goodJson({ commit_sha: 'd'.repeat(40), agent: SECRET_TEXT })) });
    const res = await s.run();
    expect(res.rejected).toBe(1);
    expect(res.ingested).toBe(0);
    const [{ row, agentRun }] = s.repo.inserted;
    expect(row.status).toBe('failed');
    expect(row.reason).toBe('Result rejected: commit_sha_mismatch');
    expect(row.findingsCount).toBeNull();
    expect(agentRun).toBeUndefined();
    expect(s.log.warn).toHaveBeenCalledTimes(1);
    const line = s.log.warn.mock.calls[0]![0] as string;
    expect(line).toContain(s.repo.syncInstallations[0]!.id);
    expect(line).toContain('run=1');
    expect(line).toContain('rule=commit_sha_mismatch');
    const all = [...s.log.warn.mock.calls, ...s.log.info.mock.calls].flat().join('\n');
    expect(all).not.toContain(SECRET_TEXT);
  });

  it('AC-62 each rejection kind produces a failed row (schema, repo id, pr, archive shape, too large)', async () => {
    const s = setup([mkRun(1), mkRun(2), mkRun(3), mkRun(4), mkRun(5)], {
      1: zipOf({ nope: true }),
      2: zipOf(goodJson({ repository_id: 5 })),
      3: zipOf(goodJson({ pr_number: 7 })),
      4: zipOf(goodJson(), 'evil.json'),
      5: new ArtifactTooLargeError(),
    });
    const res = await s.run();
    expect(res.rejected).toBe(5);
    expect(s.repo.inserted.map((i) => i.row.reason)).toEqual([
      'Result rejected: schema_invalid',
      'Result rejected: repository_id_mismatch',
      'Result rejected: pr_number_mismatch',
      'Result rejected: unexpected_entry',
      'Result rejected: archive_too_large',
    ]);
    expect(s.repo.inserted.every((i) => i.agentRun === undefined)).toBe(true);
  });

  it('AC-63 no artifact -> failed row', async () => {
    const s = setup([mkRun(1, { conclusion: 'failure' })], { 1: null });
    const res = await s.run();
    expect(res.ingested).toBe(0);
    expect(s.repo.inserted).toHaveLength(1);
    expect(s.repo.inserted[0]!.row).toMatchObject({
      status: 'failed',
      reason: 'No result artifact (the job failed before producing a result)',
      githubRunId: 1,
    });
    expect(s.repo.inserted[0]!.agentRun).toBeUndefined();
  });

  it('AC-68 one installation throws -> others synced, failure listed with code/message', async () => {
    const s = setup([mkRun(1)]);
    s.repo.syncInstallations = [
      syncInstallation({ id: 'i-bad', repo: 'acme/broken' }),
      syncInstallation({ id: 'i-ok', repo: 'acme/widgets' }),
    ];
    s.actions.listCompletedRuns.mockImplementation(async (repo: string) => {
      if (repo === 'acme/broken') throw Object.assign(new Error('Server exploded\nsecret-header: x'), { status: 500 });
      return [mkRun(1)];
    });
    const res = await s.run();
    expect(res.ingested).toBe(1);
    expect(res.failures).toEqual([{ repo: 'acme/broken', code: 'github_error', message: 'Server exploded' }]);
    expect(s.repo.inserted.map((i) => i.row.repo)).toEqual(['acme/widgets']);
    expect(s.log.info).toHaveBeenCalledTimes(2); // one sync line per installation
  });

  it('AC-68 a hanging installation times out without blocking the others', async () => {
    const s = setup([mkRun(1)]);
    s.repo.syncInstallations = [
      syncInstallation({ id: 'i-slow', repo: 'acme/slow' }),
      syncInstallation({ id: 'i-ok', repo: 'acme/widgets' }),
    ];
    s.actions.listCompletedRuns.mockImplementation(async (repo: string) =>
      repo === 'acme/slow' ? new Promise<ActionsRun[]>(() => {}) : [mkRun(1)],
    );
    const res = await syncWorkspace({ repo: asRepo(s.repo), actions: s.actions, log: s.log, timeoutMs: 30 }, 'ws');
    expect(res.ingested).toBe(1);
    expect(res.failures.map((f) => f.repo)).toEqual(['acme/slow']);
  });

  it('AC-69 403 -> github_actions_read_denied + exact message', async () => {
    const s = setup([]);
    s.actions.listCompletedRuns.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const res = await s.run();
    expect(res.failures).toEqual([
      {
        repo: 'acme/widgets',
        code: 'github_actions_read_denied',
        message:
          'The studio GitHub token cannot read GitHub Actions in acme/widgets. It needs Actions: Read (fine-grained) or the `repo` scope (classic).',
      },
    ]);
    expect(mapReadError(Object.assign(new Error('x'), { status: 403 }), 'a/b').code).toBe('github_actions_read_denied');
  });

  it('a missing workflow on the default branch (no runs) is not a failure', async () => {
    const s = setup([]);
    const res = await s.run();
    expect(res).toMatchObject({ seen: 0, ingested: 0, rejected: 0, failures: [] });
  });
});
