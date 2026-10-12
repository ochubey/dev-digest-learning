/**
 * changedFilesForPr: a PR nobody has opened has no persisted files, so the first diff is
 * empty. The PR detail is imported once (the same import the PR page does) and the diff is
 * read again, instead of reporting "no usable index".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = {
  imported: false,
  importThrows: false,
  diffThrows: false,
  noRepo: false,
  prFileRows: 0,
  /** Files the diff reports after the import (default: two). */
  filesAfterImport: 2,
};
const getPullDetail = vi.fn(async () => {
  if (state.importThrows) throw new Error('no token');
  state.imported = true;
  return {};
});

vi.mock('../src/modules/pulls/service.js', () => ({
  PullsService: class {
    getPullDetail = getPullDetail;
  },
}));
vi.mock('../src/modules/reviews/diff-loader.js', () => ({
  loadDiff: vi.fn(async () => {
    if (state.diffThrows) throw new Error('boom');
    const all = [{ path: 'src/a.ts' }, { path: 'src/b.ts' }];
    return { files: state.imported ? all.slice(0, state.filesAfterImport) : [] };
  }),
}));

import { changedFilesForPr, changedDiffForPr } from '../src/modules/blast/files.js';

const container = {
  db: {
    select: () => ({
      from: () => ({ where: async () => (state.noRepo ? [] : [{ id: 'r1', owner: 'o', name: 'n' }]) }),
    }),
  },
  reviewRepo: { getPrFiles: async () => Array.from({ length: state.prFileRows }, () => ({})) },
} as never;
const pr = { id: 'p1', repoId: 'r1' } as never;
const log = { warn: vi.fn() } as never;

beforeEach(() => {
  state.imported = false;
  state.importThrows = false;
  state.diffThrows = false;
  state.noRepo = false;
  state.prFileRows = 0;
  state.filesAfterImport = 2;
  getPullDetail.mockClear();
});

describe('changedDiffForPr', () => {
  it('(1) first diff has files -> loaded, no import', async () => {
    state.imported = true;
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('loaded');
    if (r.status === 'loaded') expect(r.diff.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(getPullDetail).not.toHaveBeenCalled();
  });

  it('(2) empty first diff, files after the import -> loaded', async () => {
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('loaded');
    if (r.status === 'loaded') expect(r.diff.files).toHaveLength(2);
    expect(getPullDetail).toHaveBeenCalledTimes(1);
  });

  it('(3) still 0 files but pr_files rows exist -> loaded with 0 files', async () => {
    state.filesAfterImport = 0;
    state.prFileRows = 3;
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('loaded');
    if (r.status === 'loaded') expect(r.diff.files).toEqual([]);
  });

  it('(4) still 0 files and 0 pr_files rows -> unavailable', async () => {
    state.filesAfterImport = 0;
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('unavailable');
  });

  it('(4) no repo row -> unavailable', async () => {
    state.noRepo = true;
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('unavailable');
  });

  it('(4) an import failure -> unavailable, reason carries no error text', async () => {
    state.importThrows = true;
    const r = await changedDiffForPr(container, 'ws', pr, log);
    expect(r.status).toBe('unavailable');
    expect(JSON.stringify(r)).not.toContain('no token');
  });

  it('concurrent callers share one resolution', async () => {
    const [a, b] = await Promise.all([
      changedDiffForPr(container, 'ws', pr, log),
      changedDiffForPr(container, 'ws', pr, log),
    ]);
    expect(a).toBe(b);
    expect(getPullDetail).toHaveBeenCalledTimes(1);
  });
});

describe('changedFilesForPr', () => {
  it('imports the PR detail once when the first diff is empty, then returns the files', async () => {
    await expect(changedFilesForPr(container, 'ws', pr, log)).resolves.toEqual(['src/a.ts', 'src/b.ts']);
    expect(getPullDetail).toHaveBeenCalledTimes(1);
  });

  it('does not import anything when the diff already has files', async () => {
    state.imported = true;
    await expect(changedFilesForPr(container, 'ws', pr, log)).resolves.toEqual(['src/a.ts', 'src/b.ts']);
    expect(getPullDetail).not.toHaveBeenCalled();
  });

  it('is fail-open: an import failure (no token) gives [] instead of throwing', async () => {
    state.importThrows = true;
    await expect(changedFilesForPr(container, 'ws', pr, log)).resolves.toEqual([]);
  });

  it('a throwing diff also falls through to the import', async () => {
    state.diffThrows = true;
    await expect(changedFilesForPr(container, 'ws', pr, log)).resolves.toEqual([]);
    expect(getPullDetail).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers for the same PR share one import (blast + history fire together)', async () => {
    const [a, b] = await Promise.all([
      changedFilesForPr(container, 'ws', pr, log),
      changedFilesForPr(container, 'ws', pr, log),
    ]);
    expect(a).toEqual(['src/a.ts', 'src/b.ts']);
    expect(b).toEqual(a);
    expect(getPullDetail).toHaveBeenCalledTimes(1);
  });

  it('does not cache across requests: a later call resolves again', async () => {
    await changedFilesForPr(container, 'ws', pr, log);
    state.imported = false;
    await changedFilesForPr(container, 'ws', pr, log);
    expect(getPullDetail).toHaveBeenCalledTimes(2);
  });
});
