import type { Risk, ReviewFocusItem } from '@devdigest/shared';
import type { BriefModelOutput } from './schema.js';
import type { DiffFact } from './diff-facts.js';
import { isSafeRepoPath, normalizeRef } from './paths.js';
import {
  MAX_SUMMARY_CHARS,
  MAX_RISKS,
  MAX_EXPLANATION_CHARS,
  MAX_FOCUS_ITEMS,
  MAX_REASON_CHARS,
} from './constants.js';

/**
 * Applies the output caps the strict JSON schema cannot carry (it has no length keywords).
 * Pure; returns a new object.
 */
export function clampOutput(out: BriefModelOutput): BriefModelOutput {
  return {
    summary: out.summary.slice(0, MAX_SUMMARY_CHARS),
    risks: out.risks.slice(0, MAX_RISKS).map((r) => ({
      ...r,
      explanation: r.explanation.slice(0, MAX_EXPLANATION_CHARS),
    })),
    review_focus: out.review_focus.slice(0, MAX_FOCUS_ITEMS).map((f) => ({
      ...f,
      reason: f.reason.slice(0, MAX_REASON_CHARS),
    })),
  };
}

export interface GroundingContext {
  /** Allow-list: canonical repo path -> diff fact (new-side ranges). */
  diff: Map<string, DiffFact>;
  /** Every caller file in the blast map. Valid for risk refs only. */
  blastFiles: Set<string>;
}

export interface GroundingCounts {
  dropped_risks: number;
  dropped_refs: number;
  dropped_focus: number;
  adjusted_lines: number;
}

export interface GroundedBrief {
  risks: Risk[];
  review_focus: ReviewFocusItem[];
  counts: GroundingCounts;
}

/**
 * Resolves a model-supplied path to the allow-list key, or null. Unsafe paths are rejected
 * first; then one leading `./` is trimmed and the match is exact and case-sensitive. The KEY
 * is returned, never the model string.
 */
function canonical(raw: string, allowed: (key: string) => boolean): string | null {
  if (!isSafeRepoPath(raw)) return null;
  const key = normalizeRef(raw);
  if (!isSafeRepoPath(key)) return null;
  return allowed(key) ? key : null;
}

/** In-range lines are kept; otherwise the nearest hunk start wins (tie -> earlier hunk). */
function snapLine(line: number, ranges: [number, number][]): number {
  if (ranges.some(([s, e]) => line >= s && line <= e)) return line;
  let best = ranges[0]![0];
  let bestDist = Math.abs(line - best);
  for (const [s] of ranges) {
    const d = Math.abs(line - s);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

export function groundBrief(out: BriefModelOutput, ctx: GroundingContext): GroundedBrief {
  const counts: GroundingCounts = {
    dropped_risks: 0,
    dropped_refs: 0,
    dropped_focus: 0,
    adjusted_lines: 0,
  };

  const risks: Risk[] = [];
  for (const r of out.risks) {
    const refs: string[] = [];
    for (const raw of r.file_refs) {
      const key = canonical(raw, (k) => ctx.diff.has(k) || ctx.blastFiles.has(k));
      if (key === null) counts.dropped_refs++;
      else if (!refs.includes(key)) refs.push(key);
    }
    if (refs.length === 0) {
      counts.dropped_risks++;
      continue;
    }
    risks.push({ ...r, file_refs: refs });
  }

  const focus: ReviewFocusItem[] = [];
  const seen = new Set<string>();
  for (const f of out.review_focus) {
    const key = canonical(f.file, (k) => ctx.diff.has(k));
    const fact = key === null ? undefined : ctx.diff.get(key);
    if (key === null || !fact || fact.ranges.length === 0 || !Number.isInteger(f.line) || f.line < 1) {
      counts.dropped_focus++;
      continue;
    }
    const line = snapLine(f.line, fact.ranges);
    const id = `${key}:${line}`;
    if (seen.has(id)) {
      counts.dropped_focus++;
      continue;
    }
    seen.add(id);
    const item: ReviewFocusItem = { file: key, line, reason: f.reason };
    if (line !== f.line) {
      item.line_adjusted = true;
      counts.adjusted_lines++;
    }
    focus.push(item);
  }

  return {
    risks: risks.slice(0, MAX_RISKS),
    review_focus: focus.slice(0, MAX_FOCUS_ITEMS),
    counts,
  };
}
