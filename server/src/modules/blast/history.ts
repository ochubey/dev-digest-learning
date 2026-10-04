import type { PrHistory, MergedPrWithFiles } from '@devdigest/shared';
import { HISTORY_LIMIT } from './constants.js';

/**
 * Prior merged PRs that touched at least one of `changedFiles`, newest first, capped at
 * HISTORY_LIMIT. `files_overlap` is the intersection; `notes` is deterministic text (no model).
 */
export function buildPrHistory(merged: MergedPrWithFiles[], changedFiles: string[]): PrHistory {
  const changed = new Set(changedFiles);
  const history = merged
    .map((pr) => ({ pr, overlap: pr.files.filter((f) => changed.has(f)) }))
    .filter(({ overlap }) => overlap.length > 0)
    .sort((a, b) => Date.parse(b.pr.merged_at) - Date.parse(a.pr.merged_at))
    .slice(0, HISTORY_LIMIT)
    .map(({ pr, overlap }) => ({
      pr_number: pr.number,
      title: pr.title,
      merged_at: pr.merged_at,
      author: pr.author,
      files_overlap: overlap,
      notes: `Touched ${overlap.length} of the files changed here.`,
    }));
  return { history };
}
