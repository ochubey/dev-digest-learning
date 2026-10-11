import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redact.js';

describe('redactSecrets (AC-55)', () => {
  it('replaces every occurrence of every secret with ***', () => {
    expect(redactSecrets('a SECRET1 b SECRET2 c SECRET1', ['SECRET1', 'SECRET2'])).toBe('a *** b *** c ***');
  });

  it('ignores empty, null, undefined and shorter-than-4-char secrets', () => {
    expect(redactSecrets('abc 123 xyz', ['', null, undefined, 'abc', '123'])).toBe('abc 123 xyz');
  });

  it('masks a secret that contains another secret in full (longest first)', () => {
    expect(redactSecrets('token=abcd1234efgh', ['abcd', 'abcd1234efgh'])).toBe('token=***');
  });

  it('is a no-op without secrets and leaves regex metacharacters alone', () => {
    expect(redactSecrets('plain', [])).toBe('plain');
    expect(redactSecrets('x a.b*c y', ['a.b*c'])).toBe('x *** y');
  });
});
