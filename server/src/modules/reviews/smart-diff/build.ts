import type { Finding, SmartDiff, SmartDiffFile, SmartDiffRole } from '@devdigest/shared';
import { isVisibleScope } from '../scope-visibility.js';
import { classifyFile } from './classify.js';
import { GROUP_ORDER } from './constants.js';

/** Minimal PR file shape (a `pr_files` row works as-is). */
export interface SmartDiffFileInput {
  path: string;
  additions: number;
  deletions: number;
}

/** Minimal finding shape (a `findings` row works as-is). */
export interface SmartDiffFindingInput {
  file: string;
  startLine: number;
  dismissedAt: Date | null;
  scope: Finding['scope'];
}

export interface SmartDiffReviewInput {
  review: { id: string; agentId: string | null; kind: 'summary' | 'review'; createdAt: Date };
  findings: SmartDiffFindingInput[];
}

/**
 * Findings of the newest `kind === 'review'` review of each agent, unioned.
 * Pure; input order does not matter. See docs/plans/smart-diff.md §5.
 */
export function latestFindingsPerAgent<F extends SmartDiffFindingInput>(
  reviews: ReadonlyArray<{ review: SmartDiffReviewInput['review']; findings: F[] }>,
): F[] {
  const newest = new Map<string, { review: SmartDiffReviewInput['review']; findings: F[] }>();
  for (const r of reviews) {
    if (r.review.kind !== 'review') continue;
    const key = r.review.agentId ?? '';
    const cur = newest.get(key);
    if (!cur || r.review.createdAt.getTime() > cur.review.createdAt.getTime()) newest.set(key, r);
  }
  return [...newest.values()].flatMap((r) => r.findings);
}

/**
 * Group PR files by role (GROUP_ORDER, empty groups omitted, files by path) and
 * attach the lines of visible findings (not dismissed, isVisibleScope).
 * Pure: no IO, no model call.
 */
export function buildSmartDiff(
  files: ReadonlyArray<SmartDiffFileInput>,
  findings: ReadonlyArray<SmartDiffFindingInput>,
): SmartDiff {
  const linesByFile = new Map<string, Set<number>>();
  for (const f of findings) {
    if (f.dismissedAt != null || !isVisibleScope(f.scope)) continue;
    let set = linesByFile.get(f.file);
    if (!set) linesByFile.set(f.file, (set = new Set()));
    set.add(f.startLine);
  }

  const byRole = new Map<SmartDiffRole, SmartDiffFile[]>();
  let totalLines = 0;
  for (const f of files) {
    totalLines += f.additions + f.deletions;
    const role = classifyFile(f.path);
    const list = byRole.get(role) ?? [];
    list.push({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: [...(linesByFile.get(f.path) ?? [])].sort((a, b) => a - b),
    });
    byRole.set(role, list);
  }

  const groups = GROUP_ORDER.flatMap((role) => {
    const list = byRole.get(role);
    if (!list || list.length === 0) return [];
    return [{ role, files: list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) }];
  });

  return {
    groups,
    split_suggestion: { too_big: false, total_lines: totalLines, proposed_splits: [] },
  };
}
