/**
 * Repo-relative path hygiene shared by diff facts, the prompt's blast caller list and
 * grounding. Pure.
 */

/** False for empty, control characters (incl. NUL, \n, \r), absolute (`/`, `\`), drive-letter paths and any `..` segment. */
export function isSafeRepoPath(p: string): boolean {
  if (p.length === 0) return false;
  if (/[\x00-\x1f\x7f]/.test(p)) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  if (p.split(/[/\\]/).some((seg) => seg === '..')) return false;
  return true;
}

/** Trims ONE leading `./`. */
export function normalizeRef(p: string): string {
  return p.startsWith('./') ? p.slice(2) : p;
}
