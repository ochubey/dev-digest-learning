import { describe, it, expect } from 'vitest';
import { filterDocEntries, decodeUtf8Strict, isBlank } from '../src/modules/project-context/docs.js';
import type { TreeEntry } from '../src/modules/project-context/ports.js';

const e = (path: string, kind: TreeEntry['kind'] = 'blob'): TreeEntry => ({
  path,
  kind,
  blobSha: `sha-${path}`,
});

describe('project-context docs', () => {
  it('keeps specs/a.md, docs/sub/b.md, insights/c.MD; drops src/d.md, docs/e.txt, symlinks, submodules', () => {
    const out = filterDocEntries([
      e('specs/a.md'),
      e('docs/sub/b.md'),
      e('insights/c.MD'),
      e('src/d.md'),
      e('docs/e.txt'),
      e('docs/link.md', 'symlink'),
      e('specs/vendored.md', 'submodule'),
      e('docs/sub', 'tree'),
    ]);
    expect(out.map((x) => x.path)).toEqual(['specs/a.md', 'docs/sub/b.md', 'insights/c.MD']);
  });

  it('strict UTF-8 rejects binary', () => {
    expect(decodeUtf8Strict(new TextEncoder().encode('héllo # title'))).toBe('héllo # title');
    expect(decodeUtf8Strict(new Uint8Array([0x23, 0xff, 0xfe, 0x00, 0x80]))).toBeNull();
    expect(decodeUtf8Strict(new Uint8Array())).toBe('');
  });

  it('isBlank is true for empty and whitespace-only text', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank(' \n\t ')).toBe(true);
    expect(isBlank('# x')).toBe(false);
  });
});
