import { describe, it, expect, vi } from 'vitest';
import { CiService } from '../src/modules/ci/service.js';
import { FakeCiRepo, agentRow, asRepo, installationRow, AGENT_ID } from './helpers/ci-store.js';
import type { RunRow } from '../src/modules/ci/repository.js';

const WS = '11111111-1111-4111-8111-111111111111';

function svc(repo: FakeCiRepo) {
  return new CiService({
    repo: asRepo(repo),
    github: async () => {
      throw new Error('no github');
    },
    actions: async () => {
      throw new Error('no actions');
    },
    runnerPath: '/x',
    readFile: async () => '',
    log: { info: vi.fn(), warn: vi.fn() },
  });
}

describe('ci service views', () => {
  it('AC-85 config_changed when version or ci_fail_on differs', async () => {
    const cases: [Partial<ReturnType<typeof agentRow>>, boolean][] = [
      [{ version: 3, ciFailOn: 'critical' }, false],
      [{ version: 4, ciFailOn: 'critical' }, true],
      [{ version: 3, ciFailOn: 'warning' }, true],
    ];
    for (const [agent, expected] of cases) {
      const repo = new FakeCiRepo();
      repo.agent = agentRow(agent);
      repo.installation = { ...installationRow({ agentVersion: 3, ciFailOn: 'critical' }), agentName: 'Secret Gate' };
      const view = await svc(repo).agentView(WS, AGENT_ID);
      expect(view.installations).toHaveLength(1);
      expect(view.installations[0]!.config_changed).toBe(expected);
    }
  });

  it('agentView attaches last_run per installation and the agent runs; unknown agent -> 404', async () => {
    const repo = new FakeCiRepo();
    repo.installation = { ...installationRow(), agentName: 'Secret Gate' };
    const run = {
      id: 'r1',
      ciInstallationId: installationRow().id,
      status: 'succeeded',
      ranAt: new Date('2026-03-01T10:00:00Z'),
      agentName: 'Secret Gate',
      prNumber: 1,
      findingsCount: 1,
      costUsd: 0.1,
      githubUrl: null,
      source: 'ci',
      durationMs: 2500,
    } as unknown as RunRow;
    repo.lastRuns = [run];
    repo.runs = [run];
    const view = await svc(repo).agentView(WS, AGENT_ID);
    expect(view.installations[0]!.last_run).toEqual({ status: 'succeeded', ran_at: '2026-03-01T10:00:00.000Z' });
    expect(view.runs).toHaveLength(1);
    expect(view.runs[0]!.duration_s).toBe(2.5);

    repo.agent = undefined;
    await expect(svc(repo).agentView(WS, AGENT_ID)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('agent without installations -> empty list (the "Not in CI yet" state)', async () => {
    const repo = new FakeCiRepo();
    const view = await svc(repo).agentView(WS, AGENT_ID);
    expect(view).toEqual({ installations: [], runs: [] });
  });

  it('listRuns returns the runs and the installation count', async () => {
    const repo = new FakeCiRepo();
    repo.count = 2;
    expect(await svc(repo).listRuns(WS)).toEqual({ runs: [], installations_count: 2 });
  });
});
