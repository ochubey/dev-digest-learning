import type { RepoRef } from '@devdigest/shared';

export interface TreeEntry {
  path: string;
  kind: 'blob' | 'tree' | 'symlink' | 'submodule';
  blobSha: string;
}

/**
 * Read access to a repository's committed files at a specific commit. Kept local to the
 * project-context module (not in the vendored adapters) so vendored contracts stay stable.
 */
export interface ProjectDocsSource {
  /** Commit sha at the tip of `branch`. Throws when it cannot be resolved. */
  resolveBranchHead(repo: RepoRef, branch: string): Promise<string>;
  /** All tree entries at `sha` (recursive). */
  listTree(repo: RepoRef, sha: string): Promise<TreeEntry[]>;
  /** Raw bytes of the file at `path` on `sha`; null when it does not exist or is not a file. */
  readBlob(repo: RepoRef, path: string, sha: string): Promise<Uint8Array | null>;
}
