import { describe, it, expect } from 'vitest';
import {
  AgentManifest,
  CI_BRANCH,
  CI_RESULT_ARTIFACT_NAME,
  CI_RUNNER_VERSION,
  CI_TRIGGERS,
  CI_WORKFLOW_PATH,
  CI_WORKFLOW_VERSION,
  CiExportInput,
  CiResultArtifact,
  CiSyncResult,
} from '@devdigest/shared';

describe('SPEC-05 contracts', () => {
  it('legacy manifest and legacy artifact (no new fields) still parse', () => {
    const m = AgentManifest.safeParse({ name: 'a', model: 'm', system_prompt: 'p' });
    expect(m.success).toBe(true);
    expect(m.data).toMatchObject({ provider: 'openrouter', skills: [], strategy: 'auto', ci_fail_on: 'critical' });
    expect(m.data!.version).toBeUndefined();
    const a = CiResultArtifact.safeParse({ findings_count: 0, cost_usd: null, agent: 'a' });
    expect(a.success).toBe(true);
  });

  it('artifact with new fields parses; unknown keys are stripped', () => {
    const a = CiResultArtifact.parse({
      findings_count: 1,
      cost_usd: 0.1,
      agent: 'a',
      commit_sha: 'abc',
      repository_id: 7,
      model: 'm',
      agent_version: 3,
      verdict: 'COMMENT',
      blockers: 0,
      sneaky: 'x',
    });
    expect(a).toMatchObject({ commit_sha: 'abc', repository_id: 7, model: 'm', agent_version: 3, verdict: 'COMMENT', blockers: 0 });
    expect('sneaky' in a).toBe(false);
  });

  it('artifact verdict and ids are validated', () => {
    const base = { findings_count: 0, cost_usd: null, agent: 'a' };
    expect(CiResultArtifact.safeParse({ ...base, verdict: 'MAYBE' }).success).toBe(false);
    expect(CiResultArtifact.safeParse({ ...base, repository_id: 1.5 }).success).toBe(false);
  });

  it('manifest version must be a positive integer', () => {
    const base = { name: 'a', model: 'm', system_prompt: 'p' };
    expect(AgentManifest.safeParse({ ...base, version: 0 }).success).toBe(false);
    expect(AgentManifest.safeParse({ ...base, version: 2 }).success).toBe(true);
  });

  it('constants', () => {
    expect(CI_WORKFLOW_VERSION).toBe(1);
    expect(CI_RUNNER_VERSION).toBe('2');
    expect(CI_BRANCH).toBe('devdigest/ci');
    expect(CI_WORKFLOW_PATH).toBe('.github/workflows/devdigest-review.yml');
    expect(CI_RESULT_ARTIFACT_NAME).toBe('devdigest-result');
    expect([...CI_TRIGGERS]).toEqual(['opened', 'synchronize', 'reopened']);
  });

  it('export input defaults and the workflow size cap', () => {
    const i = CiExportInput.parse({ repo: 'a/b' });
    expect(i).toMatchObject({ target: 'gha', action: 'open_pr', post_as: 'github_review', triggers: ['opened', 'synchronize', 'reopened'] });
    expect(CiExportInput.safeParse({ repo: 'a/b', workflow: 'x'.repeat(65_537) }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b', action: 'zip' }).success).toBe(false);
    expect(CiExportInput.safeParse({ repo: 'a/b', post_as: 'email' }).success).toBe(false);
  });

  it('sync result shape', () => {
    expect(
      CiSyncResult.safeParse({ synced_at: 'x', seen: 0, ingested: 0, rejected: 0, failures: [{ repo: 'a/b', code: 'c', message: 'm' }] }).success,
    ).toBe(true);
  });
});
