# Spec: `reviewPullRequest()` input/output contract

## Input (`ReviewInput`, `src/review/run.ts`)

Required: `systemPrompt`, `model`, `diff` (already-parsed `UnifiedDiff`),
`llm` (an `LLMProvider`). Everything else is optional and **omitted, not
empty-string'd**, when not supplied — `assemblePrompt` leaves out a prompt
section entirely rather than rendering `""`: `skills`, `memory`, `specs`,
`callers`, `repoMap`, `prDescription`, `task`.

`strategy` picks `'auto' | 'single-pass' | 'map-reduce'` — `'auto'` (the
default) only chunks per-file when the diff is **both** over
`DEFAULT_MAP_THRESHOLD_LINES` (400) lines **and** touches more than one
file; a large single-file diff still goes single-pass.

## Output (`ReviewOutcome`)

- `review: Review` — the grounded verdict/score/findings (post-gate).
- `grounding: string` — human-readable summary, e.g. `"3/4 passed"`.
- `dropped` — findings the grounding gate removed, with a reason each
  (never silently discarded from the caller's visibility).
- `tokensIn` / `tokensOut` — summed across every chunk (1 for single-pass).
- **`costUsd: number | null`** — summed across every chunk, from whatever
  the injected `LLMProvider` reports per call. **This is the authoritative
  cost figure** — a caller should use it directly rather than re-deriving
  cost from `tokensIn`/`tokensOut` + its own price table, because
  `OpenRouterProvider` prefers OpenRouter's **live billed cost** for that
  call over a static estimate when the API reports one (`costFromApi` in
  `llm/openrouter.ts`). `null` propagates if *any* chunk's cost is
  unknown — a partial cost across chunks is treated as no cost, not summed
  with a hole in it.
- `assembly` / `chunks` / `raw` — for the caller's own run-trace/logging
  needs; the engine doesn't persist anything itself.
- `mode: ReviewMode` — which path actually ran (`'single-pass'` or
  `'map-reduce'`), since `'auto'` resolves to one of these before running.

## Cancellation

`checkCancelled` is called **before each chunk** (map-reduce) — not
mid-single-call. A single-pass review cannot be interrupted once the one
LLM call has started; only a chunked (map-reduce) review can actually stop
early. A caller that needs sub-second cancellation for large single-file
diffs would need `strategy: 'map-reduce'` forced, not `'auto'`.
