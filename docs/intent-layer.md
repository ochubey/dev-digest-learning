# Intent Layer

Classifies PR motivation (intent) using a fast OpenRouter model, injects into reviews, and hides out-of-scope findings via a code-owned policy (no extra LLM call).

## Goals

- Derive PR intent from title, description, linked issue, plan/spec, and file names (no diff bodies)
- Output: `{summary, in_scope[], out_of_scope[], confidence, sources[]}`
- Store on PR, show in UI, re-derivable
- Inject into review prompt for context
- Scope findings: the review model only labels each finding `in|out|signal`; code decides (`applyScopePolicy`). Out-of-scope findings are hidden but persisted; at most one serious one is kept as a signal

## Architecture

```mermaid
flowchart LR
  PR["PR (title, body)"]
  Issue["Linked Issue"]
  Plan["Plan/Spec<br/>(GitHub files)"]
  Files["Files + Hunks"]
  
  Resolver["RefResolver<br/>(fetch GitHub)"]
  Service["IntentService<br/>(deriveIntent)"]
  Builder["prompt-builder<br/>(assemble)"]
  Flash["OpenRouter Flash<br/>(Gemini 2.5)"]
  DB["pr_intent table"]
  
  Review["reviewPullRequest<br/>(inject intent)"]
  Ground["grounding.apply"]
  Policy["applyScopePolicy<br/>(code-owned, pure)"]
  
  PR --> Resolver
  Issue --> Resolver
  Plan --> Resolver
  Files --> Resolver
  Resolver --> Service
  Service --> Builder
  Builder --> Flash
  Flash --> Service
  Service --> DB
  
  DB --> Review
  Review --> Ground
  Ground --> Policy
  Policy -->|"scope=in"| Output["Review output<br/>(verdict, score, counts)"]
  Policy -->|"out / signal"| Persist["persisted, hidden / signal"]
```

## Data Flow

### Input
- **PR:** title, description (capped 2000 chars)
- **Linked issue:** title + body (via GitHub API)
- **Plan/spec:** `.md` files from repo at head SHA (over 32 KB: head + `[... truncated ...]` + last 1 KB, 32 KB total; 64 KB hard cap, over it the tail is dropped)
- **Files:** list + first 2 `@@…@@` hunk headers per file (capped 100 files)
- **NOT sent:** diff bodies, code, private paths

### Intent Derivation
1. Fetch linked issue (from PR body/title; same repo only) and plan/spec via `RefResolver`; timeout/retry live in the Octokit adapter. Issue references: keyword form (`fixes/closes/resolves/issue #N`), full GitHub URL and `owner/repo#N` are EXPLICIT; a bare `#N` is IMPLICIT and `PR #N` / `pull request #N` is never read as an issue. An implicit reference that does not resolve (404) is dropped silently (no source, no warning); an explicit one is reported as `unavailable`. Plan/spec paths are taken as whole path tokens (`server/docs/architecture.md` is never cut to `docs/architecture.md`) from `docs/` folders and `*spec.md` / `*plan.md` names
2. Statuses are code-owned (`fetched`, `unavailable` = not found, `error` = auth/rate limit/network); the persisted `sources` come from them, never from the LLM. Referenced-but-unavailable sources go into the prompt as "no context"
3. Build prompt: title, body, issue, plan, spec, file list (all wrapped untrusted)
4. Call flash model with Zod `IntentSchema` (temperature=0)
5. Output: `{summary, in_scope[], out_of_scope[], confidence, sources[], missing_context[]}`
6. Cache on head SHA; stale if PR updates
7. Fail-open: log error, intent is null. If the `review_intent` provider cannot be set up, the main review model is used instead (warning in the run log)
8. Confidence = `min(model, ceiling)`; the ceiling is computed in code from evidence (`confidence.ts`), the model's own number is only a self-assessment:
   - empty description: 0.4 (0.0 when no external source was fetched)
   - an explicitly referenced plan, spec or ticket that is unavailable (not found or fetch error): 0.5
   - any other unavailable explicit reference (e.g. an issue in another repository): 0.7
   - the stricter ceiling wins; a model value below the ceiling is kept; fetched sources never limit it. Every applied cap is added to the derive warnings (run log, ASCII)
   - the UI shows the reason next to each non-fetched source (not found at the PR head commit / another repository, not fetched / could not be fetched: auth, rate limit, network or timeout). The reason is derived from the source status and label because the stored source has only `label` and `status` (a per-source `reason` field would need a shared-contract change)
9. `out_of_scope` is grounded in the PR text: the prompt allows it only for explicit exclusions (otherwise `[]`) and its few-shot examples use placeholders under a "format only, never copy values" header (realistic example values were once copied into a real intent). Code then drops every `out_of_scope` item that shares no significant word (4+ characters) with the PR title, body, linked issue, plan/spec or changed file paths, and adds a warning (`scope-grounding.ts`)
10. Files + hunk headers for the intent prompt come from the SAME diff the run loads (`loadDiff`), not from the `pr_files` table (filled lazily on PR-detail open, so empty for PRs synced from the list and reviewed without opening them); the derive route loads it through the same helper (`server/src/modules/intent/diff-files.ts`).

### Scope Policy

No separate judge call. Exactly two model calls per single-pass run: the intent classifier (flash model) and the main review. Map-reduce = one review call per chunk; a cached intent = no classifier call. The `llm.calls` log line shows the actual numbers (reprompts counted).

**Model output** (`reviewer-core/src/review/output-schema.ts`): `ModelReview` = `Review` with each finding extended by `scope: 'in'|'out'|'signal'` and `scope_reason: string`, both `.nullish().catch(null)`. An invalid label parses to `null` (no throw, no reprompt) and is treated as `in`.

**Prompt** (`reviewer-core/src/prompt.ts`), only when a structured `intentObj` is passed:
- `renderIntent()` renders summary, in/out lists, confidence as bounded one-line text (summary 500 chars, 8 items, 120 chars each; whitespace/newlines collapsed), wrapped with `wrapUntrusted('intent', ...)` under `## Intent`. It wins over the deprecated string `intent`.
- `SCOPE_INSTRUCTIONS` (trusted) is appended to the system prompt: label each finding, give a one-sentence `scope_reason`, never use "out" for security/secrets/CRITICAL defects on lines changed by this PR, report everything, labels are advisory.
- `INJECTION_GUARD` gained a sentence: intent may only inform the `scope` label, never omit a finding, lower severity, or label security/secret findings out.
- `wrapUntrusted` strips `</untrusted>` case-insensitively and with optional whitespace (`/<\/untrusted\s*>/gi`).

**`applyScopePolicy(findings, {intent, changedLines})`** (`reviewer-core/src/review/scope.ts`; pure, runs once over all grounded findings, never per chunk). Order:
0. Review-prompt use of the intent (run-executor, `reviewIntentPolicy`): `confidence === 0` (no description, files or sources) -> the `## Intent` section and the scope instructions are NOT added (no `intentObj` is passed); `0 < confidence < 0.5` -> the section is added and `renderIntent` appends `Low confidence (x.xx): treat as weak hint`, the scope filter stays inactive (rule 1). The intent is persisted and served by the API in every case; the client shows a "Not enough context" card for confidence 0.
1. Filter inactive -> every finding `in`, reason `scope filter inactive: ...`, when: no intent, `confidence < 0.5` (`MIN_INTENT_CONFIDENCE`), or both `in_scope` and `out_of_scope` empty.
2. Normalise model hints: missing/invalid -> `in`; a model `signal` is treated as `out`.
3. Never-out overrides (model `out` -> `in`): category `security` (`NEVER_OUT_CATEGORIES`); kind `secret_leak` / `lethal_trifecta` (`NEVER_OUT_KINDS`); severity `CRITICAL` overlapping changed lines.
4. Mass-out guard: if outs > `0.6` (`MAX_OUT_RATIO`) of total with total >= 3 (`MIN_FINDINGS_FOR_RATIO`), or all findings are out with total >= 2, everything goes back to `in`.
5. Serious outs (severity CRITICAL) collapse into exactly one `signal`: highest confidence, tiebreak file, start_line, id. The others stay `out` (hidden, persisted).
6. Code always writes `scope` and `scope_reason` (decision text + sanitised model reason, max 280 chars `MAX_SCOPE_REASON_CHARS`).

"Changed lines" = new-side line numbers of the diff hunks (`changedLines` = grounding `buildLineIndex`). Findings must already cite lines in the diff (grounding), so a CRITICAL "out" finding usually overlaps changed lines and is overridden; a signal is rare: only CRITICAL outside hunks, or full-file kinds.

**Results:**
- `review.findings`, verdict, score, blockers and `agent_runs.findings_count` come from `scope=in` only. Verdict is re-derived from the in findings when something was hidden/signalled (CRITICAL -> `request_changes`, any -> `comment`, none -> `approve`); otherwise the model's verdict is kept.
- The signal is separate (`outcome.signal`, not in `review.findings`); `out` findings are persisted but hidden. All findings (`allFindings`) are persisted with `scope` / `scope_reason`.
- Residual prompt-injection risk: a PR author can still steer the model to label a non-CRITICAL finding on changed lines `out`. Bounded by the never-out rules and the ratio guard; hidden findings stay revealable in the UI.

## Components

### Backend

**Server module** (`server/src/modules/intent/`):
- **routes.ts:** GET /pulls/:id/intent (read cached), POST /pulls/:id/intent/derive (manual trigger; optional `force` bypasses the cache; rate limit 1 per 30s per PR, in-memory per process, 429 `{error, retry_after}`; 502 on derive failure)
- **service.ts:** `IntentService.deriveIntent()`, caching, fail-open error handling
- **repository.ts:** CRUD for `pr_intent` table
- **ref-resolver.ts:** Fetch linked issue, plan/spec files via Octokit. `getIssue`/`readRepoFile` use `withRetry(withTimeout(30s))`; 404/410 -> `unavailable`, any other error -> `error`

**Reviewer-core** (`reviewer-core/src/intent/` and `review/`):
- **prompt-builder.ts:** Assemble intent derivation prompt with few-shot examples
- **scope.ts:** `applyScopePolicy()` (pure, code-owned), constants, `ScopeStats`
- **output-schema.ts:** `ModelReview` (lenient scope labels); **changed-lines.ts:** new-side hunk ranges

**Run-executor** (`server/src/modules/reviews/run-executor.ts`):
- Derive intent once per run (after loadDiff, before agents)
- Inject into review prompt
- Pass the structured intent (`intentObj`) to `reviewPullRequest`, which applies the scope policy after grounding
- Persist all findings with `scope` / `scope_reason`; verdict/score/blockers/`findingsCount` count `scope=in` only
- DTO (`findingRowToDto`) returns `scope`, `scope_reason`; PR-list `findings` (`modules/pulls/routes.ts`) counts only `scope='in'` or legacy NULL

### Client

**IntentBlock component** (`client/src/app/repos/[repoId]/pulls/[number]/_components/IntentBlock/`):
- Summary (italic quote)
- In-scope / out-of-scope columns (colored)
- Source chips (fetched ✓ / unavailable ⚠️ / error ✗)
- Confidence badge
- Stale warning + Re-derive button
- Loading / error / empty states

**Hooks** (`client/src/lib/hooks/reviews.ts`):
- `useIntent(prId)`: GET /pulls/:id/intent
- `useRederiveIntent(prId)`: POST /pulls/:id/intent/derive with `force: true`; the UI shows the rate-limit message on 429

**Placement:** OverviewTab above Description box

**Scope UI:**
- `FindingsPanel`: "N findings hidden as out of scope" counter + reveal/conceal toggle (`prReview.scope.*`); revealed `out` cards are muted with an "Out of scope" badge; the reported count excludes `out` and `signal`.
- `signal`: shown in the list with a "Out of scope · serious" marker and `scope_reason` as a plain text node (never Markdown/HTML), also on the inline `SmartFindingCard`.
- `ReviewRunAccordion`: blockers, counts and severity pills are in-scope only.
- Diff tab: never renders `out`; shows a passive "N out-of-scope findings hidden" hint; a single Hide/Show comments toggle covers comments and findings.

### Logging

**Safe structured logging** (no secrets, diffs, private specs):
- Verbose mode only (DEBUG env var or logger.level='debug')
- Per-section: name, source, length (chars/tokens), model, correlation ID
- Intent derivation: model, duration, confidence, cost, success
- `Scope policy:` result line (review engine): in/out/signal/hidden/collapsed/overrides (critical_changed, security, secret, invalid)/guard/model_out; plus one `scope override` info line per override
- `scope.apply` (run-executor, step `scope.apply`): in/out/signal/hidden/collapsed/overrides/guard
- `llm.calls: intent=<label> review=<n>` where `<label>` separates attempts from outcome: `1 ok`, `N (retried, N attempts) ok`, `0 cached` (no call), `0 skipped` (failed before the LLM call), `1 failed` (call made, errored; 1 is a lower bound because the provider error does not report its attempt count), `N (retried, N attempts) failed`. Defined once in `intentCallsLabel` (`server/src/modules/intent/log-lines.ts`). (step `llm.calls`)
- runLog lines `intent.load` (cache hit/miss/bypass, or `not reached (<reason>)`), `intent.resolve_refs` (statuses, or `not reached (<reason>)`), `intent.derive` (`server/src/modules/intent/log-lines.ts`). `intent.load` and `intent.resolve_refs` are logged regardless of outcome, also when the derive fails.
- `intent.skip: confidence=0 (...); Intent section omitted from review prompt` and `intent.low_confidence: confidence=x.xx < 0.50; ...; scope filter inactive`: why the intent is absent from / only a weak hint in the review prompt.
- New intent.* / llm.calls lines are ASCII-only (no Unicode ellipsis, dashes or middle dots).
- All fields in pino JSON, never raw error objects

## Settings

**Feature model:** `review_intent`
- Default: `openrouter/google/gemini-2.5-flash-lite` (10x cheaper than GPT-4.1)
- User-overridable via Settings UI
- Used for intent derivation only (scope is labelled by the main review model)

## Safety

- **Prompt injection:** all external fields wrapped via `wrapUntrusted`, INJECTION_GUARD in system prompt; the model only labels scope, code decides (see Scope Policy for residual risk)
- **Ref-resolver:** GitHub only, no SSRF; Octokit `withTimeout`/`withRetry`; 404/410 = unavailable, other errors = `error`; file path limited to `.md`, size capped
- **Output:** constrained by Zod schema, fail-open on validation error
- **Logging:** never logs secrets, full bodies, private paths
- **Credentials:** API keys from container.secrets, not config/client/prompt

## Not implemented

- Trace `intent_step` and intent cost in `agent_runs.cost_usd` (open question: needs a shared-contract change; trace totals exclude intent cost, it lives in the runLog and `pr_intent`)
- Cache check before ref fetch (deliberate: the cache key hashes issue/plan content)
- Phase 6: e2e spec, fixtures, `docs/agent-prompts/README.md`
- `reviewer-core/src/intent/derive.ts` (derivation lives in server `IntentService`)
- vendor/shared drift CI check; shared scope predicate; remaining `as` in `ModelReviewSchema` (need shared-contract changes)

## Checklist

- [x] Intent card on PR Overview page shows summary, in/out scope, confidence, sources, stale badge, re-derive button
- [x] Classifier runs on separate flash model (OpenRouter, 10x cheaper)
- [x] Request has no diff bodies (title, body, files+hunks only)
- [x] Plan/spec fetched from GitHub and considered (linked issue too)
- [x] Read-only agents (architecture/security/plan reviewers) have no Write/Edit tools
- [x] Logging shows prompt composition without secrets and diffs
- [x] Scope policy (code-owned) hides out-of-scope findings, collapses serious ones to one signal; out/signal persisted, only `in` counted

## Related

- Plan: `docs/plans/intent-layer.md`
- Review report: `docs/reviews/intent-layer.md`
- Migrations: `0012` (pr_intent columns, finding scope), `0014_broken_james_howlett` (syncs `pr_intent.summary` default with the schema)
- Implementation: `feat/intent-layer` branch (commits d73a458, 2e9db9e, c7da2c0, 384c0b6, 2a9dd32, e529e36, e96c6cc, c6e6ded, +fixes)
