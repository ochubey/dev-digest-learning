/**
 * Unit tests for the pure skill-import parser (server/src/modules/skills/import.ts).
 * No I/O, no DB — validates frontmatter whitelisting, size cap, and file-type
 * rejection in isolation from the route/service layer.
 */
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { parseSkillImport, MAX_IMPORT_BODY_BYTES } from '../src/modules/skills/import.js';
import { ValidationError } from '../src/platform/errors.js';

function b64(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

function zipB64(build: (zip: AdmZip) => void): string {
  const zip = new AdmZip();
  build(zip);
  return zip.toBuffer().toString('base64');
}

describe('parseSkillImport', () => {
  it('parses frontmatter name/type/description and strips the block from body', () => {
    const md = `---\nname: coverage-gap-rubric\ntype: rubric\ndescription: Flags untested branches\n---\n# Body\nCheck it.`;
    const result = parseSkillImport('whatever.md', b64(md));
    expect(result.name).toBe('coverage-gap-rubric');
    expect(result.type).toBe('rubric');
    expect(result.description).toBe('Flags untested branches');
    expect(result.body).toBe('# Body\nCheck it.');
  });

  it('falls back to filename (minus .md) when no frontmatter name is present', () => {
    const result = parseSkillImport('no-over-mocking.md', b64('Just body text.'));
    expect(result.name).toBe('no-over-mocking');
    expect(result.type).toBe('custom'); // default when unset/invalid
    expect(result.body).toBe('Just body text.');
  });

  it('drops non-whitelisted frontmatter keys (never stored/acted on)', () => {
    const md = `---\nname: x\nexec: rm -rf /\n---\nbody`;
    const result = parseSkillImport('x.md', b64(md));
    expect(result.name).toBe('x');
    expect((result as unknown as Record<string, unknown>).exec).toBeUndefined();
  });

  it('rejects a non-.md filename', () => {
    expect(() => parseSkillImport('archive.zip', b64('anything'))).toThrow(ValidationError);
  });

  it('rejects an oversized body', () => {
    const big = 'a'.repeat(MAX_IMPORT_BODY_BYTES + 1);
    expect(() => parseSkillImport('big.md', b64(big))).toThrow(ValidationError);
  });

  it('rejects an empty file', () => {
    expect(() => parseSkillImport('empty.md', b64('   \n  '))).toThrow(ValidationError);
  });

  it('falls back to type=custom for an invalid frontmatter type value', () => {
    const md = `---\ntype: not-a-real-type\n---\nbody`;
    const result = parseSkillImport('x.md', b64(md));
    expect(result.type).toBe('custom');
  });
});

describe('parseSkillImport — .zip archives', () => {
  it('parses a valid zip with exactly one root .md file', () => {
    const content = zipB64((zip) => {
      zip.addFile('skill.md', Buffer.from(`---\nname: zipped-skill\n---\nBody from zip.`, 'utf-8'));
    });
    const result = parseSkillImport('bundle.zip', content);
    expect(result.name).toBe('zipped-skill');
    expect(result.body).toBe('Body from zip.');
  });

  it('rejects a zip with no .md file', () => {
    const content = zipB64((zip) => {
      zip.addFile('readme.txt', Buffer.from('not markdown', 'utf-8'));
    });
    expect(() => parseSkillImport('bundle.zip', content)).toThrow(ValidationError);
  });

  it('rejects a zip with more than one .md file', () => {
    const content = zipB64((zip) => {
      zip.addFile('a.md', Buffer.from('A', 'utf-8'));
      zip.addFile('b.md', Buffer.from('B', 'utf-8'));
    });
    expect(() => parseSkillImport('bundle.zip', content)).toThrow(ValidationError);
  });

  it('rejects a zip with a nested directory (.md not at root)', () => {
    const content = zipB64((zip) => {
      zip.addFile('nested/skill.md', Buffer.from('Body', 'utf-8'));
    });
    expect(() => parseSkillImport('bundle.zip', content)).toThrow(ValidationError);
  });

  it('rejects a zip entry with a path-traversal segment', () => {
    const content = zipB64((zip) => {
      zip.addFile('../../etc/passwd.md', Buffer.from('Body', 'utf-8'));
    });
    expect(() => parseSkillImport('bundle.zip', content)).toThrow(ValidationError);
  });

  it('rejects a symlink entry', () => {
    const zip = new AdmZip();
    zip.addFile('skill.md', Buffer.from('Body', 'utf-8'));
    // Force a second entry to look like a symlink via unix mode bits
    // (S_IFLNK = 0o120000) encoded in the upper 16 bits of external attrs.
    zip.addFile('link.md', Buffer.from('target', 'utf-8'));
    const entries = zip.getEntries();
    const link = entries.find((e) => e.entryName === 'link.md')!;
    link.header.attr = (0o120000 << 16) | 0o755;
    const content = zip.toBuffer().toString('base64');
    expect(() => parseSkillImport('bundle.zip', content)).toThrow(ValidationError);
  });
});
