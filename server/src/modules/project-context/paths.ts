import type { ContextSource } from '@devdigest/shared';
import { isSafeRepoPath, normalizeRef } from '../brief/paths.js';
import { PROJECT_CONTEXT_FOLDERS } from './constants.js';

/** Trims ONE leading `./` (same rule as brief refs). */
export function normalizeContextPath(p: string): string {
  return normalizeRef(p);
}

/** Folder names that never hold project documentation (build output, dependencies). */
const EXCLUDED_FOLDERS: ReadonlySet<string> = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
]);

/** True for a directory name discovery never descends into (dot-folders and build/dependency output). */
export function isIgnoredFolder(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_FOLDERS.has(name);
}

/**
 * Source badge of a path: the first folder segment (file name excluded) equal to
 * specs/docs/insights wins, a file in the repo root is `root`, anything else `other`.
 */
export function classifySource(p: string): ContextSource {
  const segments = p.split('/');
  const folders = segments.slice(0, -1);
  for (const f of folders) {
    if ((PROJECT_CONTEXT_FOLDERS as readonly string[]).includes(f)) return f as ContextSource;
  }
  return folders.length === 0 ? 'root' : 'other';
}

/**
 * True for an eligible repo-relative markdown path (any depth): safe path, `.md`
 * (case-insensitive), no empty segment, no dot-file / dot-folder segment, no excluded
 * folder, not CHANGELOG.md. Does NOT normalize: callers normalize first.
 */
export function isContextDocPath(p: string): boolean {
  if (!isSafeRepoPath(p)) return false;
  if (!/\.md$/i.test(p)) return false;
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s.startsWith('.'))) return false;
  const folders = segments.slice(0, -1);
  if (folders.some(isIgnoredFolder)) return false;
  return segments[segments.length - 1]!.toLowerCase() !== 'changelog.md';
}
