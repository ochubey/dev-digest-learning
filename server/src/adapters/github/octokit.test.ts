import { describe, it, expect, vi } from 'vitest';
import { OctokitGitHubClient } from './octokit.js';

const repo = { owner: 'o', name: 'r' };

function clientWith(getContent: (...a: unknown[]) => unknown) {
  const c = new OctokitGitHubClient('tok');
  (c as unknown as { octokit: unknown }).octokit = { rest: { repos: { getContent } } };
  return c;
}

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

describe('OctokitGitHubClient.readRepoFile', () => {
  it('decodes a file', async () => {
    const c = clientWith(async () => ({ data: { type: 'file', content: b64('hello') } }));
    expect(await c.readRepoFile(repo, 'a.md', 'sha')).toBe('hello');
  });

  it('returns null for not-found (404)', async () => {
    const c = clientWith(async () => {
      throw Object.assign(new Error('Not Found'), { status: 404 });
    });
    expect(await c.readRepoFile(repo, 'a.md', 'sha')).toBeNull();
  });

  it('returns null for a directory / non-file', async () => {
    const c = clientWith(async () => ({ data: [] }));
    expect(await c.readRepoFile(repo, 'docs', 'sha')).toBeNull();
  });

  it('throws on auth errors instead of pretending the file is missing', async () => {
    const getContent = vi.fn(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });
    const c = clientWith(getContent);
    await expect(c.readRepoFile(repo, 'a.md', 'sha')).rejects.toThrow('Bad credentials');
    expect(getContent).toHaveBeenCalledTimes(1); // 401 is not retryable
  });

  it('throws on rate limit (403) and on network errors', async () => {
    const rl = clientWith(async () => {
      throw Object.assign(new Error('rate limited'), { status: 403 });
    });
    await expect(rl.readRepoFile(repo, 'a.md', 'sha')).rejects.toThrow('rate limited');
    const net = clientWith(async () => {
      throw Object.assign(new Error('nope'), { code: 'EACCES' });
    });
    await expect(net.readRepoFile(repo, 'a.md', 'sha')).rejects.toThrow('nope');
  });
});

describe('OctokitGitHubClient.listMergedPullRequestsWithFiles', () => {
  const pull = (number: number, merged_at: string | null) => ({
    number,
    title: `PR ${number}`,
    user: { login: 'u' },
    merged_at,
  });

  function clientWithPulls(list: unknown[], listFiles: (a: { pull_number: number }) => unknown) {
    const c = new OctokitGitHubClient('tok');
    (c as unknown as { octokit: unknown }).octokit = {
      rest: { pulls: { list: async () => ({ data: list }), listFiles: async (a: never) => listFiles(a) } },
    };
    return c;
  }

  it('keeps merged PRs only, excludes one number, and maps file names', async () => {
    const c = clientWithPulls([pull(1, '2026-01-01T00:00:00Z'), pull(2, null), pull(3, '2026-01-03T00:00:00Z')], (a) => ({
      data: [{ filename: `f${a.pull_number}.ts` }],
    }));
    const out = await c.listMergedPullRequestsWithFiles(repo, { excludeNumber: 3 });
    expect(out).toEqual([
      { number: 1, title: 'PR 1', author: 'u', merged_at: '2026-01-01T00:00:00Z', files: ['f1.ts'] },
    ]);
  });

  it('respects the limit and skips a PR whose files cannot be read', async () => {
    const c = clientWithPulls(
      [pull(1, '2026-01-01T00:00:00Z'), pull(2, '2026-01-02T00:00:00Z'), pull(3, '2026-01-03T00:00:00Z')],
      (a) => {
        if (a.pull_number === 1) throw Object.assign(new Error('Not Found'), { status: 404 });
        return { data: [{ filename: 'a.ts' }] };
      },
    );
    const out = await c.listMergedPullRequestsWithFiles(repo, { limit: 2 });
    expect(out.map((p) => p.number)).toEqual([2]); // PR 3 is beyond the limit, PR 1 skipped
  });
});
