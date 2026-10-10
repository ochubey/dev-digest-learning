import { Octokit } from 'octokit';
import type { RepoRef } from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import type { ProjectDocsSource, TreeEntry } from '../../modules/project-context/ports.js';
import { PROJECT_CONTEXT_FOLDERS } from '../../modules/project-context/constants.js';

const TIMEOUT = 30_000;

interface RawTreeItem {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
}

function toEntry(item: RawTreeItem, prefix: string): TreeEntry | null {
  if (!item.path || !item.sha) return null;
  let kind: TreeEntry['kind'];
  if (item.type === 'tree') kind = 'tree';
  else if (item.type === 'commit') kind = 'submodule';
  else if (item.type === 'blob') kind = item.mode === '120000' ? 'symlink' : 'blob';
  else return null;
  return { path: prefix + item.path, kind, blobSha: item.sha };
}

/** ProjectDocsSource over Octokit REST. Reads bytes (not lossy text) so non-UTF-8 is detectable. */
export class OctokitProjectDocsSource implements ProjectDocsSource {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async resolveBranchHead(repo: RepoRef, branch: string): Promise<string> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.repos.getBranch({ owner: repo.owner, repo: repo.name, branch }),
        TIMEOUT,
      ),
    );
    return res.data.commit.sha;
  }

  async listTree(repo: RepoRef, sha: string): Promise<TreeEntry[]> {
    const res = await this.getTree(repo, sha, true);
    if (!res.truncated) {
      return res.tree.map((i) => toEntry(i, '')).filter((e): e is TreeEntry => e !== null);
    }
    return this.listTreePerFolder(repo, sha);
  }

  /** Fallback for a truncated recursive tree: walk only the context folders, one tree per call. */
  private async listTreePerFolder(repo: RepoRef, sha: string): Promise<TreeEntry[]> {
    const root = await this.getTree(repo, sha, false);
    const out: TreeEntry[] = [];
    const folders = (PROJECT_CONTEXT_FOLDERS as readonly string[]).slice();
    for (const item of root.tree) {
      if (item.type !== 'tree' || !item.path || !item.sha || !folders.includes(item.path)) continue;
      await this.walk(repo, item.sha, `${item.path}/`, out);
    }
    return out;
  }

  private async walk(repo: RepoRef, treeSha: string, prefix: string, out: TreeEntry[]): Promise<void> {
    const res = await this.getTree(repo, treeSha, false);
    for (const item of res.tree) {
      const entry = toEntry(item, prefix);
      if (!entry) continue;
      out.push(entry);
      if (entry.kind === 'tree') await this.walk(repo, entry.blobSha, `${entry.path}/`, out);
    }
  }

  private async getTree(
    repo: RepoRef,
    treeSha: string,
    recursive: boolean,
  ): Promise<{ truncated: boolean; tree: RawTreeItem[] }> {
    const res = await withRetry(() =>
      withTimeout(
        this.octokit.rest.git.getTree({
          owner: repo.owner,
          repo: repo.name,
          tree_sha: treeSha,
          ...(recursive ? { recursive: 'true' } : {}),
        }),
        TIMEOUT,
      ),
    );
    return { truncated: Boolean(res.data.truncated), tree: res.data.tree as RawTreeItem[] };
  }

  async readBlob(repo: RepoRef, path: string, sha: string): Promise<Uint8Array | null> {
    let res;
    try {
      res = await withRetry(() =>
        withTimeout(
          this.octokit.rest.repos.getContent({
            owner: repo.owner,
            repo: repo.name,
            path,
            ref: sha,
          }),
          TIMEOUT,
        ),
      );
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 404 || status === 410) return null;
      throw err;
    }
    if (Array.isArray(res.data) || res.data.type !== 'file') return null;
    const content = res.data.content;
    if (typeof content !== 'string') return null;
    return new Uint8Array(Buffer.from(content, 'base64'));
  }
}
