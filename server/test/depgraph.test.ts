/**
 * Regression: the depgraph adapter must return REPO-RELATIVE POSIX paths. On Windows
 * `path.relative()` yields backslashes, which never matched the POSIX `files` list, so
 * every edge was dropped, `references.decl_file` stayed NULL and blast found no callers.
 * Runs the real dependency-cruiser on a throwaway project.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DepCruiseGraph } from '../src/adapters/depgraph/index.js';

let root: string;

beforeAll(async () => {
  // Under cwd, not os.tmpdir(): dependency-cruiser resolves paths against cwd and breaks
  // when the project sits on another drive (Windows C: temp vs E: checkout). Real clones
  // live under server/clones, so they are on the same drive.
  root = await mkdtemp(join(process.cwd(), '.tmp-depgraph-'));
  await mkdir(join(root, 'src', 'nested'), { recursive: true });
  await writeFile(join(root, 'src', 'b.ts'), 'export const b = 1;\n');
  await writeFile(join(root, 'src', 'a.ts'), "import { b } from './b';\nexport const a = b;\n");
  await writeFile(
    join(root, 'src', 'nested', 'c.ts'),
    "import { a } from '../a';\nexport const c = a;\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('DepCruiseGraph.buildEdges', () => {
  it('returns POSIX repo-relative edges that match the given file list', async () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/nested/c.ts'];
    const edges = await new DepCruiseGraph().buildEdges(root, files);
    const keys = edges.map((e) => `${e.from} -> ${e.to}`).sort();
    expect(keys).toEqual(['src/a.ts -> src/b.ts', 'src/nested/c.ts -> src/a.ts']);
    for (const e of edges) {
      expect(e.from).not.toContain('\\');
      expect(e.to).not.toContain('\\');
    }
  });
});
