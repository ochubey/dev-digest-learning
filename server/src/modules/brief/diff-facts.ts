import type { UnifiedDiff, SmartDiffRole, BriefDiffStats } from '@devdigest/shared';
import { classifyFile } from '../reviews/smart-diff/classify.js';
import { isSafeRepoPath, normalizeRef } from './paths.js';

/**
 * The only view of the diff the brief sees. No status, no raw text: it takes `files`, never
 * the whole `UnifiedDiff`, so `raw` (hunk bodies, header context) is unreachable.
 */
export interface DiffFact {
  path: string;
  role: SmartDiffRole;
  additions: number;
  deletions: number;
  /** New-side inclusive [start, end] line ranges. */
  ranges: [number, number][];
}

export function diffFacts(files: UnifiedDiff['files']): DiffFact[] {
  const out: DiffFact[] = [];
  for (const f of files) {
    const path = normalizeRef(f.path);
    if (!isSafeRepoPath(path)) continue;
    const ranges: [number, number][] = [];
    for (const h of f.hunks ?? []) {
      if (h.newLines > 0) ranges.push([h.newStart, h.newStart + h.newLines - 1]);
    }
    // Deleted, pure-rename and binary files have no new-side range: not groundable.
    if (ranges.length === 0) continue;
    out.push({
      path,
      role: classifyFile(path),
      additions: f.additions,
      deletions: f.deletions,
      ranges,
    });
  }
  return out;
}

export function diffStats(facts: DiffFact[]): BriefDiffStats {
  const by_role = { core: 0, tests: 0, wiring: 0, docs: 0, boilerplate: 0 };
  let additions = 0;
  let deletions = 0;
  for (const f of facts) {
    additions += f.additions;
    deletions += f.deletions;
    by_role[f.role]++;
  }
  return { files: facts.length, additions, deletions, by_role };
}
