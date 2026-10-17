import { Octokit } from 'octokit';
import { CI_RESULT_ARTIFACT_NAME } from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import {
  ArtifactTooLargeError,
  type ActionsRun,
  type CiActionsSource,
} from './types.js';

const TIMEOUT = 30_000;

function split(repo: string): { owner: string; repo: string } {
  const [owner = '', name = ''] = repo.split('/');
  return { owner, repo: name };
}

const call = <T>(fn: () => Promise<T>): Promise<T> => withRetry(() => withTimeout(fn(), TIMEOUT));

/** GitHub Actions reads (runs, artifacts, repository id) over Octokit REST with the studio token. */
export class OctokitActionsSource implements CiActionsSource {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async getRepoId(repo: string): Promise<number> {
    const res = await call(() => this.octokit.rest.repos.get(split(repo)));
    return res.data.id;
  }

  async secretExists(repo: string, name: string): Promise<'set' | 'not_set' | 'unknown'> {
    try {
      await withTimeout(this.octokit.rest.actions.getRepoSecret({ ...split(repo), secret_name: name }), TIMEOUT);
      return 'set';
    } catch (err) {
      return (err as { status?: number }).status === 404 ? 'not_set' : 'unknown';
    }
  }

  async listCompletedRuns(repo: string, workflowFile: string, limit: number): Promise<ActionsRun[]> {
    let res;
    try {
      res = await call(() =>
        this.octokit.rest.actions.listWorkflowRuns({
          ...split(repo),
          workflow_id: workflowFile,
          status: 'completed',
          per_page: limit,
        }),
      );
    } catch (err) {
      // The workflow file is not on the default branch yet: no runs, not an error.
      if ((err as { status?: number }).status === 404) return [];
      throw err;
    }
    return res.data.workflow_runs.slice(0, limit).map((r) => ({
      id: r.id,
      head_sha: r.head_sha,
      repository_id: r.repository.id,
      pull_requests: (r.pull_requests ?? []).map((p) => p.number),
      display_title: r.display_title ?? null,
      html_url: r.html_url ?? null,
      ran_at: r.run_started_at ?? r.created_at ?? null,
      conclusion: r.conclusion ?? null,
    }));
  }

  async downloadResultArtifact(repo: string, runId: number, maxBytes: number): Promise<Uint8Array | null> {
    const list = await call(() =>
      this.octokit.rest.actions.listWorkflowRunArtifacts({
        ...split(repo),
        run_id: runId,
        name: CI_RESULT_ARTIFACT_NAME,
        per_page: 5,
      }),
    );
    const artifact = list.data.artifacts.find((a) => !a.expired);
    if (!artifact) return null;
    // Size is checked on the listing, before anything is downloaded.
    if (artifact.size_in_bytes > maxBytes) throw new ArtifactTooLargeError();
    const res = await call(() =>
      this.octokit.rest.actions.downloadArtifact({
        ...split(repo),
        artifact_id: artifact.id,
        archive_format: 'zip',
      }),
    );
    return new Uint8Array(res.data as ArrayBuffer);
  }
}
