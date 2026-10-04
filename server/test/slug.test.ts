import { describe, it, expect } from 'vitest';
import { toSlug } from '../src/platform/slug.js';

describe('toSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(toSlug('Hello World')).toBe('hello-world');
  });

  it('caps length at maxLen', () => {
    expect(toSlug('a'.repeat(100), 10)).toHaveLength(10);
  });
});
