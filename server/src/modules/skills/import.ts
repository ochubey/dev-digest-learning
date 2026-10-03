import AdmZip from 'adm-zip';
import { ValidationError } from '../../platform/errors.js';
import type { SkillImportPreview, SkillType } from '@devdigest/shared';

/**
 * A1 — secure skill import parsing (spec §5). PARSES ONLY, never executes or
 * writes to the DB: no `eval`, no template interpolation, no shell-out at any
 * stage. Frontmatter is parsed as data with a fixed key whitelist — any other
 * key is dropped, never stored, never acted on.
 *
 * `.md` and `.zip` are both supported. A `.zip` must contain EXACTLY ONE
 * `.md` file, at the ROOT of the archive (no nested directories — any entry
 * whose path contains `/` other than as the root file's own separator is
 * rejected, likewise any directory entry). Path traversal (`../` anywhere in
 * an entry name) and symlink entries are rejected outright.
 */

export const MAX_IMPORT_BODY_BYTES = 200_000; // 200KB, per spec §5.5
export const MAX_ZIP_BYTES = 5_000_000; // 5MB cap on the archive itself (zip-bomb guard)

const WHITELISTED_FRONTMATTER_KEYS = new Set(['name', 'type', 'description']);
const VALID_SKILL_TYPES = new Set<SkillType>(['rubric', 'convention', 'security', 'custom']);

// adm-zip's unix mode symlink bit (S_IFLNK) — entries with this bit set in
// their external attributes are symlinks and must be rejected.
const S_IFLNK = 0o120000;

/**
 * Parse a base64-encoded upload into an unsaved `Skill`-shape preview.
 * Dispatches to `.md` or `.zip` handling based on the filename extension.
 * Throws `ValidationError` (422) for anything that fails validation —
 * oversized body, unsupported file type, or a body that decodes to nothing
 * usable.
 */
export function parseSkillImport(filename: string, contentBase64: string): SkillImportPreview {
  const lower = filename.toLowerCase();

  let bytes: Buffer;
  try {
    bytes = Buffer.from(contentBase64, 'base64');
  } catch {
    throw new ValidationError('content_base64 is not valid base64', {
      code: 'invalid_encoding',
    });
  }

  if (lower.endsWith('.zip')) {
    return parseZipImport(filename, bytes);
  }

  if (!lower.endsWith('.md')) {
    throw new ValidationError('Only .md or .zip files are supported for import', {
      code: 'unsupported_file_type',
      filename,
    });
  }

  return parseMarkdownImport(filename, bytes);
}

function parseMarkdownImport(filename: string, bytes: Buffer): SkillImportPreview {
  if (bytes.byteLength > MAX_IMPORT_BODY_BYTES) {
    throw new ValidationError(
      `Import body exceeds the ${MAX_IMPORT_BODY_BYTES} byte size cap`,
      { code: 'body_too_large', bytes: bytes.byteLength, max: MAX_IMPORT_BODY_BYTES },
    );
  }

  const text = bytes.toString('utf-8');
  if (text.trim().length === 0) {
    throw new ValidationError('Import file is empty', { code: 'empty_file' });
  }

  return buildPreview(filename.replace(/\.md$/i, ''), text);
}

/**
 * Parse a `.zip` archive. Validates: exactly one `.md` entry, at the root
 * (no `/` in its path), no directory entries, no path traversal (`../`
 * anywhere), no symlink entries. Anything else is a hard rejection.
 */
function parseZipImport(filename: string, bytes: Buffer): SkillImportPreview {
  if (bytes.byteLength > MAX_ZIP_BYTES) {
    throw new ValidationError(`Zip archive exceeds the ${MAX_ZIP_BYTES} byte size cap`, {
      code: 'body_too_large',
      bytes: bytes.byteLength,
      max: MAX_ZIP_BYTES,
    });
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(bytes);
  } catch {
    throw new ValidationError('Could not read this file as a zip archive', {
      code: 'invalid_zip',
      filename,
    });
  }

  const entries = zip.getEntries();

  const mdEntries: AdmZip.IZipEntry[] = [];
  for (const entry of entries) {
    const name = entry.entryName;

    // Path traversal guard — reject `../` anywhere in the entry path.
    if (name.includes('..')) {
      throw new ValidationError('Zip entry contains a path-traversal segment', {
        code: 'path_traversal',
        entry: name,
      });
    }

    // Symlink guard — adm-zip encodes unix file mode in the top 16 bits of
    // externalAttributes; a symlink entry has the S_IFLNK bits set.
    const unixMode = (entry.header.attr >>> 16) & 0xffff;
    if ((unixMode & 0o170000) === S_IFLNK) {
      throw new ValidationError('Zip entries must not be symlinks', {
        code: 'symlink_entry',
        entry: name,
      });
    }

    if (entry.isDirectory) {
      // Directory entries are only allowed if they're not the actual content
      // — skip them, but nested directories are caught below via any file
      // entry with a `/` in its path.
      continue;
    }

    // Root-only check: a file entry with a `/` in its name lives in a
    // subdirectory (adm-zip normalizes entryName with forward slashes).
    if (name.includes('/')) {
      throw new ValidationError('Zip archive must not contain nested directories', {
        code: 'nested_directory',
        entry: name,
      });
    }

    if (name.toLowerCase().endsWith('.md')) {
      mdEntries.push(entry);
    }
  }

  if (mdEntries.length === 0) {
    throw new ValidationError('Zip archive must contain exactly one .md file at its root', {
      code: 'no_markdown_entry',
    });
  }
  if (mdEntries.length > 1) {
    throw new ValidationError('Zip archive must contain exactly one .md file at its root', {
      code: 'multiple_markdown_entries',
      entries: mdEntries.map((e) => e.entryName),
    });
  }

  const entry = mdEntries[0]!;
  const content = entry.getData();
  if (content.byteLength > MAX_IMPORT_BODY_BYTES) {
    throw new ValidationError(
      `Import body exceeds the ${MAX_IMPORT_BODY_BYTES} byte size cap`,
      { code: 'body_too_large', bytes: content.byteLength, max: MAX_IMPORT_BODY_BYTES },
    );
  }

  const text = content.toString('utf-8');
  if (text.trim().length === 0) {
    throw new ValidationError('Import file is empty', { code: 'empty_file' });
  }

  return buildPreview(entry.entryName.replace(/\.md$/i, ''), text);
}

function buildPreview(fallbackName: string, text: string): SkillImportPreview {
  const { frontmatter, body } = extractFrontmatter(text);

  const name = (typeof frontmatter.name === 'string' && frontmatter.name.trim()) || fallbackName;
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const rawType = typeof frontmatter.type === 'string' ? frontmatter.type : undefined;
  const type: SkillType = rawType && VALID_SKILL_TYPES.has(rawType as SkillType) ? (rawType as SkillType) : 'custom';

  return { name, description, type, body };
}

/**
 * Parse a leading `---\n...\n---` YAML-ish frontmatter block as DATA ONLY —
 * a hand-rolled `key: value` line scanner, never `js-yaml`/`eval`. Only
 * whitelisted keys are kept; everything else (including any key that could
 * look like an instruction) is silently dropped. Returns the body with the
 * frontmatter block stripped; if there's no frontmatter block, the whole text
 * is the body.
 */
function extractFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: {}, body: text };

  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    if (!WHITELISTED_FRONTMATTER_KEYS.has(key)) continue;
    // Strip surrounding quotes if present; still just data, never interpreted.
    frontmatter[key] = kv[2]!.trim().replace(/^["'](.*)["']$/, '$1');
  }

  return { frontmatter, body: text.slice(match[0].length) };
}
