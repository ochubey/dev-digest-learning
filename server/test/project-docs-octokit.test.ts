import { describe, it, expect, vi } from 'vitest';
import { OctokitProjectDocsSource } from '../src/adapters/project-docs/octokit.js';
import { FixtureProjectDocsSource } from '../src/adapters/project-docs/fixture.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';

const repo = { owner: 'o', name: 'r' };

function sourceWith(rest: Record<string, Record<string, unknown>>) {
  const s = new OctokitProjectDocsSource('tok');
  (s as unknown as { octokit: unknown }).octokit = { rest };
  return s;
}
const b64 = (b: string | Uint8Array) => Buffer.from(b).toString('base64');

describe('OctokitProjectDocsSource', () => {
  it('resolveBranchHead returns the branch commit sha', async () => {
    const getBranch = vi.fn(async () => ({ data: { commit: { sha: 'tip1' } } }));
    const s = sourceWith({ repos: { getBranch } });
    expect(await s.resolveBranchHead(repo, 'main')).toBe('tip1');
    expect(getBranch).toHaveBeenCalledWith({ owner: 'o', repo: 'r', branch: 'main' });
  });

  it('getTree mode 120000 mapped to symlink', async () => {
    const getTree = vi.fn(async () => ({
      data: {
        truncated: false,
        tree: [
          { path: 'specs/a.md', mode: '100644', type: 'blob', sha: 'b1' },
          { path: 'docs/link.md', mode: '120000', type: 'blob', sha: 'b2' },
          { path: 'docs/sub', mode: '040000', type: 'tree', sha: 't1' },
          { path: 'insights/vendor', mode: '160000', type: 'commit', sha: 'c1' },
        ],
      },
    }));
    const s = sourceWith({ git: { getTree } });
    const out = await s.listTree(repo, 'tip');
    expect(out).toEqual([
      { path: 'specs/a.md', kind: 'blob', blobSha: 'b1' },
      { path: 'docs/link.md', kind: 'symlink', blobSha: 'b2' },
      { path: 'docs/sub', kind: 'tree', blobSha: 't1' },
      { path: 'insights/vendor', kind: 'submodule', blobSha: 'c1' },
    ]);
    expect(getTree).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledWith({ owner: 'o', repo: 'r', tree_sha: 'tip', recursive: 'true' });
  });

  it('truncated falls back to walking every non-ignored top-level tree', async () => {
    const getTree = vi.fn(async (args: { tree_sha: string; recursive?: string }) => {
      if (args.recursive) return { data: { truncated: true, tree: [] } };
      if (args.tree_sha === 'tip') {
        return {
          data: {
            truncated: false,
            tree: [
              { path: 'specs', mode: '040000', type: 'tree', sha: 'T-specs' },
              { path: 'docs', mode: '040000', type: 'tree', sha: 'T-docs' },
              { path: 'src', mode: '040000', type: 'tree', sha: 'T-src' },
              { path: 'node_modules', mode: '040000', type: 'tree', sha: 'T-nm' },
              { path: '.github', mode: '040000', type: 'tree', sha: 'T-gh' },
              { path: 'README.md', mode: '100644', type: 'blob', sha: 'r' },
            ],
          },
        };
      }
      if (args.tree_sha === 'T-specs') {
        return { data: { truncated: false, tree: [{ path: 'a.md', mode: '100644', type: 'blob', sha: 'b1' }] } };
      }
      if (args.tree_sha === 'T-docs') {
        return {
          data: {
            truncated: false,
            tree: [
              { path: 'sub', mode: '040000', type: 'tree', sha: 'T-sub' },
              { path: 'l.md', mode: '120000', type: 'blob', sha: 'b3' },
            ],
          },
        };
      }
      if (args.tree_sha === 'T-sub') {
        return { data: { truncated: false, tree: [{ path: 'b.md', mode: '100644', type: 'blob', sha: 'b2' }] } };
      }
      if (args.tree_sha === 'T-src') {
        return {
          data: {
            truncated: false,
            tree: [
              { path: 'notes.md', mode: '100644', type: 'blob', sha: 'b4' },
              { path: 'dist', mode: '040000', type: 'tree', sha: 'T-dist' },
              { path: '.cache', mode: '040000', type: 'tree', sha: 'T-cache' },
            ],
          },
        };
      }
      throw new Error(`unexpected tree ${args.tree_sha}`);
    });
    const s = sourceWith({ git: { getTree } });
    const out = await s.listTree(repo, 'tip');
    const paths = out.map((e) => `${e.kind}:${e.path}`).sort();
    expect(paths).toEqual(
      [
        'blob:README.md',
        'blob:docs/sub/b.md',
        'blob:specs/a.md',
        'blob:src/notes.md',
        'symlink:docs/l.md',
        'tree:docs/sub',
        'tree:docs',
        'tree:specs',
        'tree:src',
      ].sort(),
    );
    // ignored directories (dot-folders, node_modules, dist, ...) are never fetched
    const fetched = getTree.mock.calls.map((c) => (c[0] as { tree_sha: string }).tree_sha);
    for (const ignored of ['T-nm', 'T-gh', 'T-dist', 'T-cache']) expect(fetched).not.toContain(ignored);
    expect(fetched).toContain('T-src');
  });

  it('truncated fallback stops after a bounded number of tree requests', async () => {
    let n = 0;
    const getTree = vi.fn(async (args: { tree_sha: string; recursive?: string }) => {
      if (args.recursive) return { data: { truncated: true, tree: [] } };
      n++;
      // every tree holds one more subdirectory: an endless chain
      return {
        data: { truncated: false, tree: [{ path: 'd', mode: '040000', type: 'tree', sha: `T-${n}` }] },
      };
    });
    const s = sourceWith({ git: { getTree } });
    const out = await s.listTree(repo, 'tip');
    const nonRecursive = getTree.mock.calls.filter((c) => !(c[0] as { recursive?: string }).recursive);
    expect(nonRecursive.length).toBe(200);
    expect(out.length).toBeGreaterThan(0);
  });

  it('getContent returns bytes; 404 -> null; directory -> null; 5xx throws', async () => {
    const bytes = new Uint8Array([0x23, 0xff, 0x00]);
    const ok = sourceWith({
      repos: { getContent: async () => ({ data: { type: 'file', content: b64(bytes) } }) },
    });
    expect(Array.from((await ok.readBlob(repo, 'specs/a.md', 'tip'))!)).toEqual([0x23, 0xff, 0x00]);

    const nf = sourceWith({
      repos: {
        getContent: async () => {
          throw Object.assign(new Error('Not Found'), { status: 404 });
        },
      },
    });
    expect(await nf.readBlob(repo, 'specs/a.md', 'tip')).toBeNull();

    const dir = sourceWith({ repos: { getContent: async () => ({ data: [] }) } });
    expect(await dir.readBlob(repo, 'specs', 'tip')).toBeNull();

    const getContent = vi.fn(async () => {
      throw Object.assign(new Error('Bad credentials'), { status: 401 });
    });
    const bad = sourceWith({ repos: { getContent } });
    await expect(bad.readBlob(repo, 'specs/a.md', 'tip')).rejects.toThrow('Bad credentials');
  });

  it('5xx throws after retries', async () => {
    const getContent = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { status: 500 });
    });
    const s = sourceWith({ repos: { getContent } });
    await expect(s.readBlob(repo, 'specs/a.md', 'tip')).rejects.toThrow('boom');
  }, 30_000);
});

describe('FixtureProjectDocsSource', () => {
  const acme = { owner: 'acme', name: 'payments-api' };

  it('fixture source serves fixed sha for acme/payments-api', async () => {
    const s = new FixtureProjectDocsSource();
    const a = await s.resolveBranchHead(acme, 'main');
    const b = await s.resolveBranchHead(acme, 'develop');
    expect(a).toBe(b);
    const tree = await s.listTree(acme, a);
    const paths = tree.filter((e) => e.kind === 'blob').map((e) => e.path);
    expect(paths).toHaveLength(6);
    expect(paths).toContain('specs/security-baseline.md');
    const body = await s.readBlob(acme, 'specs/security-baseline.md', a);
    expect(new TextDecoder().decode(body!)).toContain('# ');
    expect(await s.readBlob(acme, 'specs/missing.md', a)).toBeNull();
    expect(await s.readBlob(acme, 'specs/security-baseline.md', 'other-sha')).toBeNull();
  });

  it('unknown repo lists nothing', async () => {
    const s = new FixtureProjectDocsSource();
    const sha = await s.resolveBranchHead({ owner: 'x', name: 'y' }, 'main');
    expect(await s.listTree({ owner: 'x', name: 'y' }, sha)).toEqual([]);
  });
});

describe('MockProjectDocsSource', () => {
  it('serves per-ref files, records calls, and can throw', async () => {
    const m = new MockProjectDocsSource({
      heads: { main: 'sha1' },
      files: {
        sha1: { 'specs/a.md': '# a', 'docs/b.md': new Uint8Array([1]), 'docs/c.md': new Error('x'), 'docs/d.md': null },
      },
    });
    const sha = await m.resolveBranchHead(repo, 'main');
    expect(sha).toBe('sha1');
    const tree = await m.listTree(repo, sha);
    expect(tree.map((e) => e.path).sort()).toEqual(['docs/b.md', 'docs/c.md', 'docs/d.md', 'specs/a.md']);
    expect(new TextDecoder().decode((await m.readBlob(repo, 'specs/a.md', sha))!)).toBe('# a');
    expect(await m.readBlob(repo, 'docs/d.md', sha)).toBeNull();
    expect(await m.readBlob(repo, 'docs/zzz.md', sha)).toBeNull();
    await expect(m.readBlob(repo, 'docs/c.md', sha)).rejects.toThrow('x');
    expect(m.calls.map((c) => c.method)).toEqual([
      'resolveBranchHead', 'listTree', 'readBlob', 'readBlob', 'readBlob', 'readBlob',
    ]);

    const failing = new MockProjectDocsSource({ headError: new Error('down') });
    await expect(failing.resolveBranchHead(repo, 'main')).rejects.toThrow('down');
  });
});
