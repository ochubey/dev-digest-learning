import type { RepoRef } from '@devdigest/shared';
import type { ProjectDocsSource, TreeEntry } from '../../modules/project-context/ports.js';
import { PROJECT_DOCS_FIXTURE, PROJECT_DOCS_FIXTURE_SHA } from '../../db/fixtures/project-docs.js';

const key = (repo: RepoRef) => `${repo.owner}/${repo.name}`;

/** Deterministic ProjectDocsSource: fixed commit sha, fixed files, no network. */
export class FixtureProjectDocsSource implements ProjectDocsSource {
  async resolveBranchHead(_repo: RepoRef, _branch: string): Promise<string> {
    return PROJECT_DOCS_FIXTURE_SHA;
  }

  async listTree(repo: RepoRef, sha: string): Promise<TreeEntry[]> {
    if (sha !== PROJECT_DOCS_FIXTURE_SHA) return [];
    const files = PROJECT_DOCS_FIXTURE[key(repo)] ?? {};
    return Object.keys(files).map((path) => ({ path, kind: 'blob' as const, blobSha: `fixture:${path}` }));
  }

  async readBlob(repo: RepoRef, path: string, sha: string): Promise<Uint8Array | null> {
    if (sha !== PROJECT_DOCS_FIXTURE_SHA) return null;
    const body = PROJECT_DOCS_FIXTURE[key(repo)]?.[path];
    return body === undefined ? null : new TextEncoder().encode(body);
  }
}
