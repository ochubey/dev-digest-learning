import { describe, it, expect, vi } from 'vitest';
import { OctokitActionsSource } from '../src/adapters/github-actions/octokit.js';
import { ArtifactTooLargeError } from '../src/modules/ci/ports.js';

function source(rest: Record<string, Record<string, unknown>>) {
  const s = new OctokitActionsSource('ghp_FAKE');
  (s as unknown as { octokit: unknown }).octokit = { rest };
  return s;
}

describe('OctokitActionsSource', () => {
  it('getRepoId returns the numeric repository id', async () => {
    const get = vi.fn(async () => ({ data: { id: 777 } }));
    const s = source({ repos: { get } });
    expect(await s.getRepoId('acme/widgets')).toBe(777);
    expect(get).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' });
  });

  it('listWorkflowRuns 404 -> [] (the workflow is not on the default branch yet)', async () => {
    const listWorkflowRuns = vi.fn(async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    const s = source({ actions: { listWorkflowRuns } });
    expect(await s.listCompletedRuns('acme/widgets', 'devdigest-review.yml', 30)).toEqual([]);
    expect(listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'widgets', workflow_id: 'devdigest-review.yml', status: 'completed', per_page: 30 }),
    );
  });

  it('other list errors propagate (403 is reported as a sync failure upstream)', async () => {
    const s = source({ actions: { listWorkflowRuns: async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); } } });
    await expect(s.listCompletedRuns('a/b', 'w.yml', 30)).rejects.toMatchObject({ status: 403 });
  });

  it('maps runs to the port shape and honours the limit', async () => {
    const run = (id: number) => ({
      id,
      head_sha: 'sha' + id,
      repository: { id: 999 },
      pull_requests: [{ number: 42 }],
      display_title: 'T',
      html_url: 'https://github.com/a/b/actions/runs/' + id,
      run_started_at: '2026-03-01T10:00:00Z',
      created_at: '2026-03-01T09:00:00Z',
      conclusion: 'success',
    });
    const s = source({ actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [run(1), run(2), run(3)] } }) } });
    const out = await s.listCompletedRuns('a/b', 'w.yml', 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: 1,
      head_sha: 'sha1',
      repository_id: 999,
      pull_requests: [42],
      display_title: 'T',
      html_url: 'https://github.com/a/b/actions/runs/1',
      ran_at: '2026-03-01T10:00:00Z',
      conclusion: 'success',
    });
  });

  it('expired or absent artifact -> null, without a download', async () => {
    const downloadArtifact = vi.fn();
    const none = source({ actions: { listWorkflowRunArtifacts: async () => ({ data: { artifacts: [] } }), downloadArtifact } });
    expect(await none.downloadResultArtifact('a/b', 1, 1_048_576)).toBeNull();
    const expired = source({
      actions: {
        listWorkflowRunArtifacts: async () => ({ data: { artifacts: [{ id: 9, expired: true, size_in_bytes: 10 }] } }),
        downloadArtifact,
      },
    });
    expect(await expired.downloadResultArtifact('a/b', 1, 1_048_576)).toBeNull();
    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it('size_in_bytes >1 MB -> archive_too_large without download', async () => {
    const downloadArtifact = vi.fn();
    const s = source({
      actions: {
        listWorkflowRunArtifacts: async () => ({ data: { artifacts: [{ id: 9, expired: false, size_in_bytes: 1_048_577 }] } }),
        downloadArtifact,
      },
    });
    const err = await s.downloadResultArtifact('a/b', 1, 1_048_576).catch((e) => e);
    expect(err).toBeInstanceOf(ArtifactTooLargeError);
    expect(err.message).toBe('archive_too_large');
    expect(downloadArtifact).not.toHaveBeenCalled();
  });

  it('downloads the named, non-expired artifact as a zip', async () => {
    const listWorkflowRunArtifacts = vi.fn(async () => ({
      data: { artifacts: [{ id: 1, expired: true, size_in_bytes: 5 }, { id: 2, expired: false, size_in_bytes: 5 }] },
    }));
    const downloadArtifact = vi.fn(async () => ({ data: new Uint8Array([1, 2, 3]).buffer }));
    const s = source({ actions: { listWorkflowRunArtifacts, downloadArtifact } });
    const bytes = await s.downloadResultArtifact('a/b', 7, 1_048_576);
    expect(Array.from(bytes!)).toEqual([1, 2, 3]);
    expect(listWorkflowRunArtifacts).toHaveBeenCalledWith(expect.objectContaining({ run_id: 7, name: 'devdigest-result' }));
    expect(downloadArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact_id: 2, archive_format: 'zip' }));
  });
});
