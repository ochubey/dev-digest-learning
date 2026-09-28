# Spec: the review-run flow

This is the contract — what must stay true when the review pipeline changes.
For the "why" behind each step, see `README.md`'s Review context section and
`docs/architecture.md`; this doc is the step-by-step behavior.

## Trigger → persisted findings

`POST /pulls/:id/review` (`modules/reviews/routes.ts`) → `ReviewService.runReview`
→ one `ReviewRunExecutor.run(...)` call per target agent (fan-out is
per-agent, isolated: one agent's failure never aborts another's run).

1. **Diff load** (`modules/reviews/diff-loader.ts`, `loadDiff`) — prefers a
   real `git diff base...head` (`container.git`); falls back to
   reconstructing a synthetic unified diff from persisted `pr_files` patches
   when the repo isn't cloned yet (`diffFromPrFiles`). A PR with no patch
   data in either place reviews as an **empty diff** (0 findings, not an
   error) — this is expected for hand-seeded demo PRs, not a bug.
2. **Prompt assembly** (`reviewer-core/prompt.ts`, via `reviewPullRequest`) —
   system prompt (agent's own, with `INJECTION_GUARD` appended) + repo map +
   caller-signatures digest (both from `container.repoIntel`, when enabled
   and indexed) + PR description + the diff. Every section that would be
   empty is **omitted**, not sent as `""`.
3. **LLM call** — through `container.llm(agent.provider)`, single-pass or
   chunked per `agent.strategy`. Cost comes from `reviewer-core`'s
   `ReviewOutcome.costUsd` (see `reviewer-core/specs/review-contract.md`) —
   summed per chunk there, preferring a live billed cost from the provider
   over the injected `priceBook.estimate` fallback. `run-executor.ts` uses
   this value directly; it does not re-estimate cost itself. `null` means
   the model/cost was unknown for at least one chunk, not a failure.
4. **Grounding gate** (`groundFindings`, called inside `reviewPullRequest`) —
   every finding must cite a `file:line` that exists in the diff or it is
   dropped; the score is recomputed from the surviving findings only (the
   model's self-reported score is never trusted directly).
5. **Persistence** — one `reviews` row (`kind: 'review'`, `run_id` linking
   back to the `agent_runs` row), N `findings` rows, one `agent_runs` row
   (`status: 'done'`, `cost_usd`, `tokens_in`, `tokens_out`,
   `findings_count`, `score`, `blockers`), one `run_traces` row (the full
   `RunTrace` document: config + stats + prompt_assembly + tool_calls +
   raw_output + log).
6. **Failure/cancel path** — `RunCancelledError` (checked between chunked
   calls, not mid-single-call) or any other throw still persists an
   `agent_runs` row (`status: 'failed'` or `'cancelled'`, `cost_usd: null`,
   `tokens_in/out: 0`) and a minimal `RunTrace` from the in-memory SSE event
   buffer, so the run's failure and its log survive a page reload.

## PR-list aggregation (derived, not stored)

`GET /repos/:id/pulls` (`modules/pulls/routes.ts`) computes three PR-level
numbers on every read, from the rows above — none of these are columns on
`pull_requests` itself:

- **`score`** — the average of each **agent's own latest** review score
  (dedup by `agent_id`, not by review row — a re-run of the same agent
  doesn't double-count). One agent giving `request_changes` always pulls the
  PR average down, regardless of run order.
- **`cost_usd`** — the **sum** of every `status='done'` `agent_runs.cost_usd`
  for the PR. `null` only when the PR has zero successful runs.
- **`findings`** — the **latest** review's findings only (not summed/averaged
  across agents): `severity_counts` (CRITICAL/WARNING/SUGGESTION tally) +
  `items` (a read-only preview: severity, title, category, file, start_line,
  confidence — no rationale/suggestion, that payload is PR-detail-only).

## Per-run findings UI (client contract, for reference)

Each `ReviewRunAccordion` card owns its **own** severity pill row + filter,
scoped only to that run's `review.findings` — clicking "Critical" inside one
run's card never affects another run's card or the PR-list aggregate above.
