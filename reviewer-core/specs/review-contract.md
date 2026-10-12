# Spec: `reviewPullRequest()` input/output contract

## Input (`ReviewInput`, `src/review/run.ts`)

Required: `systemPrompt`, `model`, `diff` (already-parsed `UnifiedDiff`),
`llm` (an `LLMProvider`). Everything else is optional and **omitted, not
empty-string'd**, when not supplied — `assemblePrompt` leaves out a prompt
section entirely rather than rendering `""`: `skills`, `memory`, `specs`,
`projectContext`, `callers`, `repoMap`, `prDescription`, `intent` (deprecated string), `intentObj`,
`task`.

`intentObj?: Intent` — structured derived intent. When present, the prompt gets a
bounded, `wrapUntrusted` `## Intent` section (`renderIntent`) and the trusted
`SCOPE_INSTRUCTIONS` are appended to the system prompt; it also drives the
scope policy below. Absent, or confidence < 0.5, or empty in/out lists → scope
filter inactive (every finding `in`).

`projectContext?: ProjectContextDoc[]` (`{ path, content }`, in effective order) —
project documents attached to the agent/skills. Each one is rendered whole (never
summarised) by `wrapProjectDoc` as `<untrusted source="<path>">…</untrusted>`
(path attribute-escaped; a body cannot forge the closing or an opening tag) under
`## Project context`, in every chunk call, and the trusted `PROJECT_CONTEXT_GUARD`
is appended to the system prompt. When present it replaces the legacy `specs`
section. Scope, grounding and verdict never read it.

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
- `projectContext: { path, text }[]` — the wrapped blocks exactly as sent
  (`[]` when none), so the caller can store them in the run trace and count tokens.
- `assembly` / `chunks` / `raw` — for the caller's own run-trace/logging
  needs; the engine doesn't persist anything itself.
- `review.findings` — in-scope (`scope='in'`) findings ONLY; they drive score,
  verdict and counters. Out/signal findings are NOT here.
- `allFindings: Finding[]` — EVERY grounded finding (incl. the single
  serious-but-out-of-intent `signal`) annotated `scope` (`in|out|signal`) +
  `scope_reason`; **this is what the caller persists**. (There is no separate
  `signal` field: find it via `allFindings.find(f => f.scope === 'signal')`.)
- `scope: ScopeStats` — counters (`in/out/signal/hidden/collapsed`,
  `modelHints`, `overrides`, `overridesTotal` (their sum, computed once in
  `scope.ts`), `guardTripped`, `active`).
- `llmCalls: number` — structured review calls made, reprompts included.
- `mode: ReviewMode` — which path actually ran (`'single-pass'` or
  `'map-reduce'`), since `'auto'` resolves to one of these before running.

## Scope policy (code-owned, no extra LLM call)

The model only **labels** each finding (`ModelReview`: `scope: in|out|signal` +
`scope_reason`, both `.nullish().catch(null)` — a bad label parses to `null`,
costs no reprompt, and counts as `in`). `applyScopePolicy` (`review/scope.ts`,
pure) then decides, once over all grounded findings (never per chunk):

1. Inactive (no intent / confidence < 0.5 / both scope lists empty) → all `in`.
2. Normalise hints (missing/invalid → `in`; model `signal` treated as `out`).
3. Never-out → `in`: category `security`; kind `secret_leak`/`lethal_trifecta`;
   `CRITICAL` overlapping changed lines. "Changed lines" = new-side hunk ranges
   incl. context lines (`changedLines`), so a signal is rare (CRITICAL outside hunks / full-file kinds).
4. Mass-out guard: outs > 0.6 of total (total ≥ 3) or all-out (total ≥ 2) →
   everything `in`.
5. `CRITICAL` outs collapse into one `signal` (confidence desc, then file,
   line, id); the rest stay `out` (hidden, persisted).

Verdict, score and `review.findings` derive from `scope='in'` only; when
something was hidden/signalled the verdict is re-derived from them
(`deriveScopedVerdict` in `review/scope.ts`). The engine emits the single
human-readable `Scope policy: ...` line (`formatScopeStats`) and per-override
`info` events; callers should not log a second copy.

Model calls per run: single-pass = 1 review call (map-reduce = 1 per chunk);
the intent classifier is a separate call owned by the server (none when cached).

## Cancellation

`checkCancelled` is called **before each chunk** (map-reduce) — not
mid-single-call. A single-pass review cannot be interrupted once the one
LLM call has started; only a chunked (map-reduce) review can actually stop
early. A caller that needs sub-second cancellation for large single-file
diffs would need `strategy: 'map-reduce'` forced, not `'auto'`.
