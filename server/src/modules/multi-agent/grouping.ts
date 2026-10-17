import type { AttributedFinding, Conflict, ConflictTake, FindingGroup } from '@devdigest/shared';
import { JACCARD_MIN, LINE_GAP, MIN_WORD_LEN, SEVERITY_RANK } from './constants.js';

/**
 * Pure grouping of findings from several agents (read-only: nothing is stored).
 * Deterministic: the output does not depend on the input order.
 */

/** A finished (done) agent column, as far as takes are concerned. */
export interface FinishedColumn {
  run_id: string;
  agent_id: string | null;
  agent_name: string;
}

const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= MIN_WORD_LEN),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Same file, lines within LINE_GAP, and same category or similar titles. */
export function linked(a: AttributedFinding, b: AttributedFinding): boolean {
  if (a.file !== b.file) return false;
  const gap = Math.max(a.start_line, b.start_line) - Math.min(a.end_line, b.end_line);
  if (gap > LINE_GAP) return false;
  return a.category === b.category || jaccard(titleWords(a.title), titleWords(b.title)) >= JACCARD_MIN;
}

const byPosition = (a: AttributedFinding, b: AttributedFinding): number =>
  cmp(a.file, b.file) ||
  cmp(a.start_line, b.start_line) ||
  cmp(a.end_line, b.end_line) ||
  cmp(a.agent_name, b.agent_name) ||
  cmp(a.id, b.id);

/** Most severe first, then agent name, then id. */
const bySeverity = (a: AttributedFinding, b: AttributedFinding): number =>
  SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
  cmp(a.agent_name, b.agent_name) ||
  cmp(a.id, b.id);

/** Union-find over `linked` pairs; groups carry no takes yet. */
export function groupFindings(findings: AttributedFinding[]): FindingGroup[] {
  const sorted = [...findings].sort(byPosition);
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  // Run ids per component root: two findings of one run are different issues,
  // so a union never joins components that share a run.
  const runs = sorted.map((f) => new Set([f.run_id]));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i]!.file !== sorted[j]!.file) break; // sorted by file first
      if (!linked(sorted[i]!, sorted[j]!)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri === rj) continue;
      const a = runs[ri]!;
      const b = runs[rj]!;
      if ([...b].some((r) => a.has(r))) continue;
      parent[rj] = ri;
      for (const r of b) a.add(r);
    }
  }

  const buckets = new Map<number, AttributedFinding[]>();
  sorted.forEach((f, i) => {
    const root = find(i);
    const list = buckets.get(root);
    if (list) list.push(f);
    else buckets.set(root, [f]);
  });

  const groups: FindingGroup[] = [];
  for (const members of buckets.values()) {
    const ordered = [...members].sort(
      (a, b) => cmp(a.agent_name, b.agent_name) || cmp(a.start_line, b.start_line) || cmp(a.id, b.id),
    );
    const head = [...members].sort(bySeverity)[0]!;
    const smallestId = members.map((m) => m.id).sort(cmp)[0]!;
    groups.push({
      id: `grp_${smallestId}`,
      file: head.file,
      start_line: Math.min(...members.map((m) => m.start_line)),
      end_line: Math.max(...members.map((m) => m.end_line)),
      title: head.title,
      members: ordered,
      takes: [],
      is_conflict: false,
    });
  }
  return groups.sort((a, b) => cmp(a.file, b.file) || cmp(a.start_line, b.start_line) || cmp(a.id, b.id));
}

/**
 * Per group, one take per finished column (flagged -> its most severe member,
 * otherwise 'ignored'). Needs at least two finished columns to compare.
 * is_conflict = the takes do not all carry the same verdict.
 */
export function applyTakes(groups: FindingGroup[], finished: FinishedColumn[]): FindingGroup[] {
  if (finished.length < 2) return groups.map((g) => ({ ...g, takes: [], is_conflict: false }));
  const columns = [...finished].sort((a, b) => cmp(a.agent_name, b.agent_name) || cmp(a.run_id, b.run_id));
  return groups.map((g) => {
    const takes: ConflictTake[] = columns.map((c) => {
      const mine = g.members.filter((m) => m.run_id === c.run_id).sort(bySeverity);
      const top = mine[0];
      return {
        agent_id: c.agent_id,
        run_id: c.run_id,
        persona: c.agent_name,
        verdict: top ? top.severity : 'ignored',
        note: top ? top.title : '',
      };
    });
    return { ...g, takes, is_conflict: new Set(takes.map((t) => t.verdict)).size > 1 };
  });
}

/** The conflicting groups, in the legacy `Conflict` shape. */
export function conflictsOf(groups: FindingGroup[]): Conflict[] {
  return groups
    .filter((g) => g.is_conflict)
    .map((g) => ({ file: g.file, line: g.start_line, title: g.title, takes: g.takes }));
}
