import type { DiffToken } from "@/components/evals";

export interface DiffChunk {
  k: DiffToken["k"];
  text: string;
}

/** Merge adjacent tokens of the same kind so the prompt diff renders as a few runs, not one node per word. */
export function chunkDiff(tokens: readonly DiffToken[]): DiffChunk[] {
  const out: DiffChunk[] = [];
  for (const tok of tokens) {
    const last = out[out.length - 1];
    if (last && last.k === tok.k) last.text += tok.t;
    else out.push({ k: tok.k, text: tok.t });
  }
  return out;
}

export type DiffRow = { kind: "line"; chunks: DiffChunk[] } | { kind: "gap"; count: number };

/** Split merged chunks into lines (a chunk may span newlines); each line keeps its chunk kinds. */
export function toLines(chunks: readonly DiffChunk[]): DiffChunk[][] {
  const lines: DiffChunk[][] = [[]];
  for (const c of chunks) {
    c.text.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part !== "") lines[lines.length - 1]?.push({ k: c.k, text: part });
    });
  }
  return lines;
}

/** Keep changed lines plus `context` lines around each; collapse longer unchanged stretches into one gap row.
    A stretch of a single hidden line is shown as-is (a gap row would not save space). */
export function buildDiffRows(chunks: readonly DiffChunk[], context = 2, expanded = false): DiffRow[] {
  const lines = toLines(chunks);
  const changed = lines.map((l) => l.some((c) => c.k !== "same"));
  const keep = lines.map(() => expanded);
  if (!expanded) {
    changed.forEach((isChanged, i) => {
      if (!isChanged) return;
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
    });
  }
  const rows: DiffRow[] = [];
  let hidden = 0;
  const flush = (at: number) => {
    if (hidden === 1) rows.push({ kind: "line", chunks: lines[at - 1] ?? [] });
    else if (hidden > 1) rows.push({ kind: "gap", count: hidden });
    hidden = 0;
  };
  lines.forEach((l, i) => {
    if (keep[i]) {
      flush(i);
      rows.push({ kind: "line", chunks: l });
    } else hidden++;
  });
  flush(lines.length);
  return rows;
}
