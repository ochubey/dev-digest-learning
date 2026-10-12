/** One completed GitHub Actions run of the DevDigest workflow. */
export interface ActionsRun {
  id: number;
  head_sha: string;
  repository_id: number;
  pull_requests: number[];
  display_title: string | null;
  html_url: string | null;
  ran_at: string | null;
  conclusion: string | null;
}

/**
 * Read access to GitHub Actions for the ci module. Kept local (not in the vendored
 * adapters) so shared contracts and the container stay untouched.
 */
export interface CiActionsSource {
  /** GitHub's numeric id of the repository ("owner/name"). */
  getRepoId(repo: string): Promise<number>;
  /** Newest completed runs of the workflow; `[]` when the workflow is not on the default branch yet (404). */
  listCompletedRuns(repo: string, workflowFile: string, limit: number): Promise<ActionsRun[]>;
  /**
   * Bytes of the run's non-expired `devdigest-result` artifact archive; null when there is none.
   * Throws `ArtifactTooLargeError` when it exceeds `maxBytes`, without downloading.
   */
  downloadResultArtifact(repo: string, runId: number, maxBytes: number): Promise<Uint8Array | null>;
}

export class ArtifactTooLargeError extends Error {
  constructor() {
    super('archive_too_large');
    this.name = 'ArtifactTooLargeError';
  }
}
