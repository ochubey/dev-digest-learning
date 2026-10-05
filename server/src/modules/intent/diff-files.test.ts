import { describe, it, expect } from 'vitest';
import { assembleIntentPrompt } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { intentFilesFromDiff } from './diff-files.js';

const RAW = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,2 +1,3 @@',
  ' x',
  '+y',
  '@@ -20,1 +21,2 @@',
  ' z',
  '+w',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -5 +5 @@',
  '-old',
  '+new',
].join('\n');

describe('intentFilesFromDiff (single source of truth: the diff the run loaded)', () => {
  it('maps every diff file to { path, patch } where patch carries the hunk headers', () => {
    const files = intentFilesFromDiff(parseUnifiedDiff(RAW));
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(files[0]!.patch).toBe('@@ -1,2 +1,3 @@\n@@ -20,1 +21,2 @@');
    expect(files[1]!.patch).toBe('@@ -5,1 +5,1 @@');
  });

  it('tolerates files without hunks', () => {
    expect(intentFilesFromDiff({ raw: '', files: [{ path: 'a.ts' }] } as never)).toEqual([
      { path: 'a.ts', patch: '' },
    ]);
  });

  it('empty pr_files + a loaded diff -> intent prompt stats files > 0, files_in_prompt > 0, hunk_headers > 0', () => {
    // pr_files is empty here by construction: the files come ONLY from the diff.
    const { stats } = assembleIntentPrompt({
      title: 'T',
      body: 'B',
      files: intentFilesFromDiff(parseUnifiedDiff(RAW)),
    });
    expect(stats.files).toBe(2);
    expect(stats.filesIncluded).toBe(2);
    expect(stats.hunkHeaders).toBe(3);
  });
});
