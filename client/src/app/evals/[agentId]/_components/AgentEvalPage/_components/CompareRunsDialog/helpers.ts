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
