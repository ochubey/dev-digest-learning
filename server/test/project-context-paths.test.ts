import { describe, it, expect } from 'vitest';
import {
  classifySource,
  isContextDocPath,
  normalizeContextPath,
} from '../src/modules/project-context/paths.js';

describe('project-context paths', () => {
  it('classifySource: first specs/docs/insights folder segment wins, root, other', () => {
    expect(classifySource('specs/a.md')).toBe('specs');
    expect(classifySource('docs/a.md')).toBe('docs');
    expect(classifySource('insights/a.md')).toBe('insights');
    expect(classifySource('specs/deep/er/a.md')).toBe('specs');
    expect(classifySource('docs/sub/b.MD')).toBe('docs');
    expect(classifySource('client/specs/x.md')).toBe('specs');
    expect(classifySource('server/docs/specs/x.md')).toBe('docs');
    expect(classifySource('README.md')).toBe('root');
    expect(classifySource('specs.md')).toBe('root');
    expect(classifySource('src/d.md')).toBe('other');
    // the file name is not a folder segment
    expect(classifySource('src/docs.md')).toBe('other');
  });

  it('rejects absolute, .., NUL, noise folders, dot paths, CHANGELOG, non-.md; accepts .MD', () => {
    const bad = [
      '/etc/passwd',
      '/specs/a.md',
      '\\specs\\a.md',
      'C:/specs/a.md',
      'specs/../secrets.md',
      '../specs/a.md',
      '../x.md',
      'specs/a\0.md',
      'specs/a\n.md',
      'specs/a.txt',
      'docs/e.txt',
      'specs',
      'specs/',
      'specs//a.md',
      '',
      './specs/a.md',
      'specs/.env',
      'node_modules/p/r.md',
      'a/node_modules/p/r.md',
      'vendor/x.md',
      'dist/x.md',
      'build/x.md',
      'out/x.md',
      'coverage/x.md',
      '.claude/s.md',
      '.next/x.md',
      'docs/.hidden/x.md',
      '.hidden.md',
      'CHANGELOG.md',
      'docs/changelog.MD',
    ];
    for (const p of bad) expect(isContextDocPath(p), JSON.stringify(p)).toBe(false);
    const good = [
      'specs/a.md',
      'insights/c.MD',
      'docs/sub/b.md',
      'docs/sub/b.MD',
      'docs/a.Md',
      'README.md',
      'src/d.md',
      'client/specs/x.md',
      'docs/CHANGELOG-notes.md',
    ];
    for (const p of good) expect(isContextDocPath(p), p).toBe(true);
  });

  it('normalizeContextPath trims exactly one leading ./', () => {
    expect(normalizeContextPath('./specs/a.md')).toBe('specs/a.md');
    expect(normalizeContextPath('././specs/a.md')).toBe('./specs/a.md');
    expect(normalizeContextPath('specs/a.md')).toBe('specs/a.md');
  });
});
