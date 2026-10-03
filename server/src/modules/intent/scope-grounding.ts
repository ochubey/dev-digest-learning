// Cheap, deterministic guard for the intent classifier's `out_of_scope` list.
//
// The model is told to list only exclusions the PR text states explicitly, but a few-shot
// example once leaked into a real answer ("admin dashboard", "email verification"). An item is
// kept only if at least one of its significant words (4+ letters/digits) appears somewhere in
// the evidence (PR title, body, linked issue, plan/spec, changed file paths). Items without any
// significant word (e.g. "UI") cannot be judged and are kept.

const MIN_WORD_LEN = 4;

function significantWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= MIN_WORD_LEN);
}

export interface GroundedScope {
  kept: string[];
  dropped: string[];
}

export function groundOutOfScope(items: readonly string[], evidence: string): GroundedScope {
  const haystack = evidence.toLowerCase();
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    const words = significantWords(item);
    if (words.length === 0 || words.some((w) => haystack.includes(w))) kept.push(item);
    else dropped.push(item);
  }
  return { kept, dropped };
}
