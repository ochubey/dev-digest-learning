import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Files + hunk headers for the intent prompt, taken from the SAME `UnifiedDiff` the review
 * run loads (`loadDiff`: `git diff base...head`, falling back to pr_files patches). This is
 * the single source of truth for "what changed" for both the review and the intent.
 *
 * Why not the `pr_files` table directly (the old behaviour): `pr_files` is only populated
 * lazily by GET /pulls/:id (PR detail open, which needs a working GitHub call). The PR
 * list sync (polling/routes.ts) inserts only `pull_requests` rows, so a PR that was synced
 * and reviewed without its detail page ever being opened (or whose detail refresh failed)
 * has an EMPTY `pr_files`, while the run's own diff is loaded from the git clone and has
 * all files. Result observed on PR #4: "files=0 files_in_prompt=0 hunk_headers=0" next to
 * "Diff ready - 16 changed file(s)".
 *
 * The intent prompt only needs hunk headers (`@@ -a,b +c,d @@`), which are rebuilt from
 * the parsed hunks.
 */
export function intentFilesFromDiff(diff: UnifiedDiff): Array<{ path: string; patch: string }> {
  return diff.files.map((f) => ({
    path: f.path,
    patch: (f.hunks ?? [])
      .map((h) => `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`)
      .join('\n'),
  }));
}
