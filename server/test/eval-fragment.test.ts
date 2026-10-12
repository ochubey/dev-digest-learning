import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { buildFragment, fragmentCovers } from '../src/modules/evals/fragment.js';

const body = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `+${tag}${i}`).join('\n');
const RAW = [
  'diff --git a/src/other.ts b/src/other.ts',
  'index 1..2 100644',
  '--- a/src/other.ts',
  '+++ b/src/other.ts',
  '@@ -1,1 +1,2 @@',
  ' keep',
  '+added',
  'diff --git a/src/a.ts b/src/a.ts',
  'index 3..4 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' one',
  '+two',
  ' three',
  ' four',
  '@@ -40,3 +41,4 @@ function x() {',
  ' ctx',
  '-old',
  '+new1',
  '+new2',
  ' tail',
  '',
].join('\n');

describe('buildFragment', () => {
  it('two-hunk file, finding in 2nd hunk -> exactly that hunk with original @@ header; reparse yields same new-side numbers', () => {
    const r = buildFragment(RAW, 'src/a.ts', 42, 43);
    if (!('fragment' in r)) throw new Error('expected fragment');
    expect(r.fragment).toContain('@@ -40,3 +41,4 @@ function x() {');
    expect(r.fragment).not.toContain('@@ -1,3 +1,4 @@');
    expect(r.fragment).not.toContain('src/other.ts');
    expect(r.fragment.split('\n')[0]).toBe('diff --git a/src/a.ts b/src/a.ts');
    const orig = parseUnifiedDiff(RAW).files.find((f) => f.path === 'src/a.ts')!.hunks[1]!;
    const re = parseUnifiedDiff(r.fragment);
    expect(re.files).toHaveLength(1);
    expect(re.files[0]!.hunks).toHaveLength(1);
    expect(re.files[0]!.hunks[0]!.newLineNumbers).toEqual(orig.newLineNumbers);
    expect(fragmentCovers(r.fragment, 'src/a.ts', 42, 43)).toBe(true);
  });

  it('range spanning two hunks -> both', () => {
    const r = buildFragment(RAW, './src/a.ts', 4, 42);
    if (!('fragment' in r)) throw new Error('expected fragment');
    expect(r.fragment).toContain('@@ -1,3 +1,4 @@');
    expect(r.fragment).toContain('@@ -40,3 +41,4 @@');
    expect(parseUnifiedDiff(r.fragment).files[0]!.hunks).toHaveLength(2);
  });

  it('no intersecting hunk -> not_in_diff', () => {
    expect(buildFragment(RAW, 'src/a.ts', 20, 25)).toEqual({ error: 'not_in_diff' });
    expect(buildFragment(RAW, 'src/missing.ts', 1, 2)).toEqual({ error: 'not_in_diff' });
    expect(fragmentCovers(RAW, 'src/a.ts', 20, 25)).toBe(false);
  });

  it('> 32 KB -> too_large', () => {
    const big = [
      'diff --git a/big.ts b/big.ts',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -0,0 +1,5000 @@',
      body(5000, 'const value_number_'),
      '',
    ].join('\n');
    expect(buildFragment(big, 'big.ts', 1, 2)).toEqual({ error: 'too_large' });
  });
});
