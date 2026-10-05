import type { Finding, FindingRecord, ReviewRecord } from "@devdigest/shared";

/**
 * THE scope-visibility predicates (one definition for the whole client; mirrored
 * server-side by server/src/modules/reviews/scope-visibility.ts).
 *  - `isVisibleScope`: not suppressed (`out`); null/undefined (legacy) counts as in.
 *    `signal` IS visible (shown separately).
 *  - `isInScope`: null/undefined or `in` only; excludes `signal`. Drives verdict
 *    numbers (blockers, counts, severity pills).
 */
export function isVisibleScope(scope: Finding["scope"]): boolean {
  return scope !== "out";
}

export function isInScope(scope: Finding["scope"]): boolean {
  return scope == null || scope === "in";
}

/**
 * THE visibility rule for findings in the UI (single source of truth: the group
 * header counter, the file-card dot and the inline cards are all derived from the
 * list this returns).
 *
 * Visible = findings of the newest `kind === 'review'` review of each agent
 * (by `created_at`), unioned, minus:
 *  - dismissed findings (`dismissed_at` set): not visible, do not count;
 *  - `scope === 'out'`.
 * Accepted findings (`accepted_at` set) STAY visible (rendered muted) and count.
 *
 * Mirrors the server rule used for `finding_lines`
 * (server/src/modules/reviews/smart-diff/build.ts, via scope-visibility.ts), but the UI never reads
 * `finding_lines` for counters. Pure; input order does not matter.
 * See docs/plans/smart-diff.md §5-6.
 */
function latestReviewFindings(
  reviews: readonly ReviewRecord[] | null | undefined,
): FindingRecord[] {
  const newest = new Map<string, { at: number; review: ReviewRecord }>();
  for (const r of reviews ?? []) {
    if (r.kind !== "review") continue;
    const key = r.agent_id ?? "";
    const at = Date.parse(r.created_at);
    const cur = newest.get(key);
    if (!cur || at > cur.at) newest.set(key, { at, review: r });
  }
  return [...newest.values()]
    .flatMap(({ review }) => review.findings)
    .filter((f) => f.dismissed_at == null);
}

export function latestFindingsPerAgent(
  reviews: readonly ReviewRecord[] | null | undefined,
): FindingRecord[] {
  return latestReviewFindings(reviews).filter((f) => isVisibleScope(f.scope));
}

/**
 * Findings suppressed by the scope policy (`scope === 'out'`; not dismissed, newest
 * review per agent). Only for the "N hidden as out of scope" counters; they are never
 * part of the visible list. `signal` findings are NOT here: they stay visible.
 */
export function hiddenByScope(
  reviews: readonly ReviewRecord[] | null | undefined,
): FindingRecord[] {
  return latestReviewFindings(reviews).filter((f) => !isVisibleScope(f.scope));
}

/** Distinct file paths that have at least one of the given (visible) findings. */
export function filesWithFindings(findings: readonly FindingRecord[]): Set<string> {
  return new Set(findings.map((f) => f.file));
}
