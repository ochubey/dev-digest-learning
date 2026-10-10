import { describe, it, expect } from 'vitest';
import {
  classifySource,
  isContextDocPath,
  normalizeContextPath,
} from '../src/modules/project-context/paths.js';

describe('project-context paths', () => {
  it('classifySource per folder and nested', () => {
    expect(classifySource('specs/a.md')).toBe('specs');
    expect(classifySource('docs/a.md')).toBe('docs');
    expect(classifySource('insights/a.md')).toBe('insights');
    expect(classifySource('specs/deep/er/a.md')).toBe('specs');
    expect(classifySource('docs/sub/b.MD')).toBe('docs');
    expect(classifySource('src/a.md')).toBeNull();
    expect(classifySource('README.md')).toBeNull();
  });

  it('rejects absolute, .., NUL, outside folders, non-.md; accepts .MD', () => {
    const bad = [
      '/etc/passwd',
      '/specs/a.md',
      '\\specs\\a.md',
      'C:/specs/a.md',
      'specs/../secrets.md',
      '../specs/a.md',
      'specs/a\0.md',
      'specs/a\n.md',
      'src/index.md',
      'specs/a.txt',
      'docs/e.txt',
      'specs',
      'specs.md',
      'specs/',
      'specs//a.md',
      '',
      './specs/a.md',
      'specs/.env',
    ];
    for (const p of bad) expect(isContextDocPath(p), JSON.stringify(p)).toBe(false);
    for (const p of ['specs/a.md', 'insights/c.MD', 'docs/sub/b.md', 'docs/a.Md']) {
      expect(isContextDocPath(p), p).toBe(true);
    }
  });

  it('normalizeContextPath trims exactly one leading ./', () => {
    expect(normalizeContextPath('./specs/a.md')).toBe('specs/a.md');
    expect(normalizeContextPath('././specs/a.md')).toBe('./specs/a.md');
    expect(normalizeContextPath('specs/a.md')).toBe('specs/a.md');
  });
});
