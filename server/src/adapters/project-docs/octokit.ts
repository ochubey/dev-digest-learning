import { Octokit } from 'octokit';
import type { RepoRef } from '@devdigest/shared';
import { withRetry, withTimeout } from '../../platform/resilience.js';
import type { ProjectDocsSource, TreeEntry } from '../../modules/project-context/ports.js';
import { isIgnoredFolder } from '../../modules/project-context/paths.js';

const TIMEOUT = 30_000;
/** Upper bound of tree requests in the truncated-tree fallback (root included). */
const MAX_FALLBACK_TREE_REQUESTS = 200;

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

  /**
   * Fallback for a truncated recursive tree: walk every non-ignored directory one tree per
   * call, breadth first, stopping after MAX_FALLBACK_TREE_REQUESTS requests (partial result).
   */
  private async listTreePerFolder(repo: RepoRef, sha: string): Promise<TreeEntry[]> {
    const out: TreeEntry[] = [];
    const queue: { sha: string; prefix: string }[] = [{ sha, prefix: '' }];
    for (let requests = 0; queue.length > 0 && requests < MAX_FALLBACK_TREE_REQUESTS; requests++) {
      const next = queue.shift()!;
      const res = await this.getTree(repo, next.sha, false);
      for (const item of res.tree) {
        if (item.type === 'tree' && item.path && isIgnoredFolder(item.path)) continue;
        const entry = toEntry(item, next.prefix);
        if (!entry) continue;
        out.push(entry);
        if (entry.kind === 'tree') queue.push({ sha: entry.blobSha, prefix: `${entry.path}/` });
      }
    }
    return out;
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
