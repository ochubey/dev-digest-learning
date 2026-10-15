import AdmZip from 'adm-zip';
import type { CiFile } from '@devdigest/shared';
import { MAX_ARCHIVE_BYTES, MAX_RESULT_JSON_BYTES, RESULT_FILE } from './constants.js';

/** Fixed entry time so the same files always give the same zip bytes. */
const FIXED_TIME = new Date(Date.UTC(2020, 0, 1));

export function buildZip(files: CiFile[]): Buffer {
  const zip = new AdmZip();
  for (const f of files) {
    zip.addFile(f.path, Buffer.from(f.contents, 'utf8'));
    const entry = zip.getEntry(f.path);
    if (entry) entry.header.time = FIXED_TIME;
  }
  return zip.toBuffer();
}

export type ArchiveRule =
  | 'archive_too_large'
  | 'archive_invalid'
  | 'unexpected_entry'
  | 'unsafe_entry_name'
  | 'json_too_large'
  | 'json_invalid';

export type ArchiveResult = { ok: true; json: unknown } | { ok: false; rule: ArchiveRule };

const bad = (rule: ArchiveRule): ArchiveResult => ({ ok: false, rule });

/** Reads the one allowed entry of a downloaded artifact archive, within size limits (AC-58). */
export function readResultArchive(bytes: Uint8Array): ArchiveResult {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) return bad('archive_too_large');
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(Buffer.from(bytes)).getEntries();
  } catch {
    return bad('archive_invalid');
  }
  const entry = entries[0];
  if (entries.length !== 1 || !entry || entry.isDirectory) return bad('unexpected_entry');
  const name = entry.entryName;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return bad('unsafe_entry_name');
  if (name !== RESULT_FILE) return bad('unexpected_entry');
  // The declared size is checked before anything is inflated; adm-zip also caps inflation at it.
  if (entry.header.size > MAX_RESULT_JSON_BYTES) return bad('json_too_large');
  let data: Buffer;
  try {
    data = entry.getData();
  } catch {
    return bad('archive_invalid');
  }
  if (data.length > MAX_RESULT_JSON_BYTES) return bad('json_too_large');
  try {
    return { ok: true, json: JSON.parse(data.toString('utf8')) };
  } catch {
    return bad('json_invalid');
  }
}
