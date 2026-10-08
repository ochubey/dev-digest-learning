/**
 * changedFilesForPr: a PR nobody has opened has no persisted files, so the first diff is
 * empty. The PR detail is imported once (the same import the PR page does) and the diff is
 * read again, instead of reporting "no usable index".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = { imported: false, importThrows: false, diffThrows: false };
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
    return { files: state.imported ? [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] : [] };
  }),
}));

import { changedFilesForPr } from '../src/modules/blast/files.js';

const container = {
  db: { select: () => ({ from: () => ({ where: async () => [{ id: 'r1', owner: 'o', name: 'n' }] }) }) },
  reviewRepo: {},
} as never;
const pr = { id: 'p1', repoId: 'r1' } as never;
const log = { warn: vi.fn() } as never;

beforeEach(() => {
  state.imported = false;
  state.importThrows = false;
  state.diffThrows = false;
  getPullDetail.mockClear();
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
