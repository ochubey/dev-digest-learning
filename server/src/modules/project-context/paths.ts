import type { ContextSource } from '@devdigest/shared';
import { isSafeRepoPath, normalizeRef } from '../brief/paths.js';
import { PROJECT_CONTEXT_FOLDERS } from './constants.js';

/** Trims ONE leading `./` (same rule as brief refs). */
export function normalizeContextPath(p: string): string {
  return normalizeRef(p);
}

/** Top-level folder a path belongs to, or null when outside specs/docs/insights. */
export function classifySource(p: string): ContextSource | null {
  const first = p.split('/')[0];
  return (PROJECT_CONTEXT_FOLDERS as readonly string[]).includes(first ?? '')
    ? (first as ContextSource)
    : null;
}

/**
 * True for a repo-relative markdown path under specs/, docs/ or insights/ (any depth).
 * Rejects absolute paths, `..`, control chars, empty segments and non-`.md` files.
 * Does NOT normalize: callers normalize first.
 */
export function isContextDocPath(p: string): boolean {
  if (!isSafeRepoPath(p)) return false;
  const segments = p.split('/');
  if (segments.length < 2 || segments.some((s) => s === '')) return false;
  if (classifySource(p) === null) return false;
  return /\.md$/i.test(p);
}
