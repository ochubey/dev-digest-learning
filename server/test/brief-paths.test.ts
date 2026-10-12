import { describe, it, expect } from 'vitest';
import { isSafeRepoPath, normalizeRef } from '../src/modules/brief/paths.js';

describe('isSafeRepoPath', () => {
  it.each([
    ['NUL', 'a\0b'],
    ['newline', 'a\nb.ts'],
    ['carriage return', 'a\rb.ts'],
    ['tab', 'a\tb.ts'],
    ['DEL', 'a\x7fb.ts'],
    ['trailing newline', 'src/a.ts\n'],
    ['leading slash', '/a'],
    ['leading backslash', '\\a'],
    ['empty', ''],
    ['bare drive', 'C:'],
    ['drive path', 'c:/a'],
    ['mid traversal', 'a/../b'],
    ['bare ..', '..'],
    ['backslash traversal', 'a\\..\\b'],
  ])('rejects %s', (_n, p) => {
    expect(isSafeRepoPath(p)).toBe(false);
  });

  it.each(['src/a.ts', 'a..b', 'a/b..c/d', './a'])('accepts %s', (p) => {
    expect(isSafeRepoPath(p)).toBe(true);
  });
});

describe('normalizeRef', () => {
  it('trims one leading ./', () => {
    expect(normalizeRef('./a')).toBe('a');
    expect(normalizeRef('././a')).toBe('./a');
    expect(normalizeRef('src/a.ts')).toBe('src/a.ts');
  });
  it('makes ./a safe after normalize', () => {
    expect(isSafeRepoPath(normalizeRef('./a'))).toBe(true);
  });
});
