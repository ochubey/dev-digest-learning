import type { TreeEntry } from './ports.js';
import { isContextDocPath } from './paths.js';

/** Regular blobs that are valid project-context documents. Symlinks and submodules are dropped. */
export function filterDocEntries(entries: TreeEntry[]): TreeEntry[] {
  return entries.filter((e) => e.kind === 'blob' && isContextDocPath(e.path));
}

/** Decode as UTF-8; null when the bytes are not valid UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}
