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
