import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { CiResultArtifact } from '@devdigest/shared';
import {
  NO_ARTIFACT_REASON,
  agentRunValues,
  failedRunRow,
  rejectedReason,
  statusFor,
  validRunRow,
  validateArtifact,
  type IngestInstallation,
} from '../src/modules/ci/ingest.js';
import type { ActionsRun } from '../src/modules/ci/ports.js';
import { buildZip, readResultArchive } from '../src/modules/ci/zip.js';

const SHA = 'a'.repeat(40);
const run = (over: Partial<ActionsRun> = {}): ActionsRun => ({
  id: 5001,
  head_sha: SHA,
  repository_id: 999,
  pull_requests: [42],
  display_title: 'Add feature',
  html_url: 'https://github.com/acme/widgets/actions/runs/5001',
  ran_at: '2026-03-01T10:00:00Z',
  conclusion: 'failure',
  ...over,
});
const inst: IngestInstallation = {
  id: 'inst-1',
  agentId: 'agent-1',
  workspaceId: 'ws-1',
  agentName: 'Secret Gate',
  repo: 'acme/widgets',
  githubRepoId: 999,
  workflowVersion: 1,
};
const artifact = (over: Record<string, unknown> = {}) => ({
  findings_count: 3,
  critical: 1,
  warning: 1,
  suggestion: 1,
  cost_usd: 0.012,
  duration_ms: 4200,
  agent: 'Secret Gate',
  version: '2',
  pr_number: 42,
  commit_sha: SHA,
  repository_id: 999,
  model: 'deepseek/deepseek-v4-flash',
  agent_version: 3,
  verdict: 'REQUEST_CHANGES',
  blockers: 1,
  ...over,
});
const archive = (entries: Record<string, string | Buffer>): Uint8Array => {
  const zip = new AdmZip();
  for (const [name, data] of Object.entries(entries)) zip.addFile(name, Buffer.from(data));
  return zip.toBuffer();
};
const RESULT = 'devdigest-result.json';

describe('readResultArchive', () => {
  it('AC-58: valid passes', () => {
    const r = readResultArchive(archive({ [RESULT]: JSON.stringify(artifact()) }));
    expect(r).toEqual({ ok: true, json: artifact() });
  });

  it('AC-58: archive >1 MB rejected', () => {
    const big = new Uint8Array(1_048_577);
    expect(readResultArchive(big)).toEqual({ ok: false, rule: 'archive_too_large' });
  });

  it('AC-58: not a zip rejected', () => {
    const r = readResultArchive(new Uint8Array([1, 2, 3, 4, 5]));
    expect(r.ok).toBe(false);
  });

  it('AC-58: JSON >64 KB (actual) rejected', () => {
    const json = JSON.stringify({ ...artifact(), pad: 'x'.repeat(70_000) });
    expect(readResultArchive(archive({ [RESULT]: json }))).toEqual({ ok: false, rule: 'json_too_large' });
  });

  it('AC-58: JSON >64 KB with a declared header size is rejected before inflating', () => {
    const bytes = archive({ [RESULT]: JSON.stringify({ pad: 'x'.repeat(70_000) }) });
    // The check is on the declared size: a highly compressible 70 KB entry stays well under 1 MB zipped.
    expect(bytes.byteLength).toBeLessThan(1_048_576);
    expect(readResultArchive(bytes)).toEqual({ ok: false, rule: 'json_too_large' });
  });

  it('AC-58: two entries rejected', () => {
    expect(readResultArchive(archive({ [RESULT]: '{}', 'extra.txt': 'x' }))).toEqual({ ok: false, rule: 'unexpected_entry' });
  });

  it('AC-58: other name rejected', () => {
    expect(readResultArchive(archive({ 'other.json': '{}' }))).toEqual({ ok: false, rule: 'unexpected_entry' });
  });

  it('AC-58: a/devdigest-result.json and ../x rejected', () => {
    expect(readResultArchive(archive({ [`a/${RESULT}`]: '{}' }))).toEqual({ ok: false, rule: 'unsafe_entry_name' });
    // adm-zip sanitizes names on addFile, so a hostile name is forced onto the entry header.
    for (const hostile of ['../x', '..\\x', '/abs/x']) {
      const zip = new AdmZip();
      zip.addFile('placeholder', Buffer.from('{}'));
      zip.getEntries()[0]!.entryName = hostile;
      const r = readResultArchive(zip.toBuffer());
      expect(r.ok, hostile).toBe(false);
    }
  });

  it('empty archive and invalid JSON rejected', () => {
    expect(readResultArchive(new AdmZip().toBuffer()).ok).toBe(false);
    expect(readResultArchive(archive({ [RESULT]: '{not json' }))).toEqual({ ok: false, rule: 'json_invalid' });
  });
});

describe('validateArtifact', () => {
  it('a matching artifact is accepted', () => {
    const r = validateArtifact(artifact(), run(), inst);
    expect(r.ok).toBe(true);
  });

  it('AC-58 unknown keys stripped', () => {
    const r = validateArtifact({ ...artifact(), evil: '<script>', nested: { a: 1 } }, run(), inst);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.artifact)).not.toContain('evil');
      expect(Object.keys(r.artifact)).not.toContain('nested');
      expect(CiResultArtifact.safeParse(r.artifact).success).toBe(true);
    }
  });

  it('AC-58: schema violations are rejected as schema_invalid', () => {
    for (const bad of [null, 'x', [], {}, artifact({ findings_count: 'many' }), artifact({ verdict: 'LGTM' }), artifact({ agent: undefined })]) {
      expect(validateArtifact(bad, run(), inst)).toEqual({ ok: false, rule: 'schema_invalid' });
    }
  });

  it('AC-59 commit sha mismatch', () => {
    expect(validateArtifact(artifact({ commit_sha: 'b'.repeat(40) }), run(), inst)).toEqual({ ok: false, rule: 'commit_sha_mismatch' });
    expect(validateArtifact(artifact({ commit_sha: null }), run(), inst)).toEqual({ ok: false, rule: 'commit_sha_mismatch' });
    const { commit_sha: _omit, ...noSha } = artifact();
    expect(validateArtifact(noSha, run(), inst)).toEqual({ ok: false, rule: 'commit_sha_mismatch' });
  });

  it('AC-60 repo id mismatch vs run and vs installation', () => {
    expect(validateArtifact(artifact({ repository_id: 1 }), run(), inst)).toEqual({ ok: false, rule: 'repository_id_mismatch' });
    // matches the run but not the stored installation id
    expect(
      validateArtifact(artifact({ repository_id: 1 }), run({ repository_id: 1 }), inst),
    ).toEqual({ ok: false, rule: 'repository_id_mismatch' });
    expect(validateArtifact(artifact({ repository_id: null }), run(), inst)).toEqual({ ok: false, rule: 'repository_id_mismatch' });
  });

  it('AC-60 an installation without a stored github id is checked against the run only', () => {
    expect(validateArtifact(artifact(), run(), { githubRepoId: null }).ok).toBe(true);
    expect(validateArtifact(artifact({ repository_id: 5 }), run(), { githubRepoId: null })).toEqual({
      ok: false,
      rule: 'repository_id_mismatch',
    });
  });

  it('AC-61 pr number not in run.pull_requests', () => {
    expect(validateArtifact(artifact({ pr_number: 43 }), run(), inst)).toEqual({ ok: false, rule: 'pr_number_mismatch' });
    expect(validateArtifact(artifact({ pr_number: null }), run(), inst)).toEqual({ ok: false, rule: 'pr_number_mismatch' });
  });

  it('AC-61 empty pull_requests -> accepted', () => {
    expect(validateArtifact(artifact({ pr_number: 99 }), run({ pull_requests: [] }), inst).ok).toBe(true);
  });
});

describe('rows and status', () => {
  it('AC-66 0 findings -> no_findings, >0 -> succeeded even with REQUEST_CHANGES', () => {
    expect(statusFor({ findings_count: 0 })).toBe('no_findings');
    expect(statusFor({ findings_count: 2 })).toBe('succeeded');
    const a = CiResultArtifact.parse(artifact({ verdict: 'REQUEST_CHANGES' }));
    expect(validRunRow(run(), inst, a).status).toBe('succeeded');
  });

  it('AC-62 failed row has reason "Result rejected: <rule>" and no counts', () => {
    const row = failedRunRow(run(), inst, rejectedReason('commit_sha_mismatch'));
    expect(row.status).toBe('failed');
    expect(row.reason).toBe('Result rejected: commit_sha_mismatch');
    for (const k of ['findingsCount', 'costUsd', 'verdict', 'critical', 'warning', 'suggestion', 'durationMs', 'model', 'agentVersion', 'runnerVersion'] as const) {
      expect(row[k], k).toBeNull();
    }
    expect(row.githubRunId).toBe(5001);
    expect(row.prNumber).toBe(42);
    expect(row.source).toBe('ci');
  });

  it('AC-63 reason text', () => {
    expect(NO_ARTIFACT_REASON).toBe('No result artifact (the job failed before producing a result)');
    expect(failedRunRow(run(), inst, NO_ARTIFACT_REASON).reason).toBe(NO_ARTIFACT_REASON);
  });

  it('valid row copies the artifact fields; agent_runs row has source ci, status done, blockers (AC-64)', () => {
    const a = CiResultArtifact.parse(artifact());
    const row = validRunRow(run(), inst, a);
    expect(row).toMatchObject({
      status: 'succeeded',
      findingsCount: 3,
      critical: 1,
      warning: 1,
      suggestion: 1,
      costUsd: 0.012,
      durationMs: 4200,
      model: 'deepseek/deepseek-v4-flash',
      agentVersion: 3,
      runnerVersion: '2',
      verdict: 'REQUEST_CHANGES',
      commitSha: SHA,
      prTitle: 'Add feature',
      reason: null,
    });
    const ar = agentRunValues(row, a, 'pr-uuid');
    expect(ar).toMatchObject({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
      prId: 'pr-uuid',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      durationMs: 4200,
      status: 'done',
      source: 'ci',
      findingsCount: 3,
      blockers: 1,
      severityCounts: { critical: 1, warning: 1, suggestion: 1 },
      costUsd: 0.012,
    });
    expect(agentRunValues(row, a, null).prId).toBeNull();
  });

  it('GitHub-supplied strings are capped before storage', () => {
    const row = failedRunRow(run({ display_title: 'x'.repeat(2000) }), inst, 'r');
    expect(row.prTitle!.length).toBeLessThanOrEqual(500);
  });
});

describe('buildZip', () => {
  it('is deterministic for the same files', () => {
    const files = [{ path: 'a/b.txt', contents: 'hi', editable: false }];
    expect(buildZip(files).equals(buildZip(files))).toBe(true);
  });
});
