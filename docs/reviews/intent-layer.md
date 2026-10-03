# Intent Layer Review Report

**Branch:** `feat/intent-layer` (commits d73a458, 2e9db9e, c7da2c0)  
**Review date:** 2026-10-03  
**Reviewed by:** architecture-reviewer, security-reviewer, plan-verifier  
**Status:** 3 independent reviews, no fixes applied (read-only findings only)

---

## Executive Summary

Intent Layer backend, client UI, and logging have been implemented per `docs/plans/intent-layer.md`. All requirements are PARTIAL: code is present but lacks tests and has 5 blockers (compilation error, judge/scope filter not wired, migration default issue, cache behavior, no tests). Security: no exploitable findings at >80% confidence. Architecture: 13 findings (mostly medium/low), primary issues are adapter coupling, contract inconsistency, and duplication.

---

## 1. Architecture Review

**13 findings** (high: 1, medium: 7, low: 5)

### High severity

| ID | Smell | File:line | Violated rule | Consequence | Fix |
|----|---|---|---|---|---|
| A10 | vendored-contract syntax error | `server/src/vendor/shared/contracts/platform.ts:53-55`, `client/src/vendor/shared/contracts/platform.ts:53-55` | Valid TypeScript | Uses curly quotes (U+2018/2019) instead of ASCII quotes. This is a syntax error in both vendor copies. | Replace `'review_intent'` and `'Intent Classifier'` with straight quotes (`'` not `'`). |

### Medium severity

| ID | Smell | File:line | Rule | Consequence |
|----|---|---|---|---|
| A1 | leaky-abstraction (adapter coupling) | `ref-resolver.ts:1,24` vs `service.ts:14-15` | Depend on GitHubClient port, not concrete OctokitGitHubClient | `readRepoFile` is OctokitGitHubClient-only. RefResolver needs unsafe cast or typecheck failure. MockGitHubClient lacks the method, so integration tests cannot mock. |
| A2 | cross-module instantiation | `run-executor.ts:12,118` | Modules talk through facade, not construct each other | `reviews` instantiates `IntentService` directly, tying executor to intent's constructor shape. No import cycle, but wrong dependency. |
| A3 | routes bypass repository | `routes.ts:6,48,95,108,116,61,141` | Routes use repository, not raw schema | Routes query `t.pullRequests`, `t.repos`, `t.prFiles` directly via `container.db`, skipping IntentRepository. Row→response mapping duplicated (lines 70-83 and 150-163). |
| A4 | duplicated orchestration | `intent/routes.ts:122-127` vs `run-executor.ts:117-120` | Single place for "resolve model → derive intent" | `review_intent` model resolution and `provider/model` string are duplicated. Can drift. |
| A5 | prompt formatting in wrong layer | `run-executor.ts:133` | Prompt assembly in reviewer-core, not server | Server hand-builds `## Intent Sources\n…` markdown as intent: string, dropping `sources` and `missing_context`. Prompt.ts adds a second `## Intent` heading, so output has nested headings. Should be structured Intent type. |
| A6 | dead code (scope filter) | `scope.ts:32,87` exported at `index.ts:66-67` | Scope filter wired into run.ts | `scopeFindings` and `simpleScopeFindings` have no callers. No scope handling in run.ts. `finding.scope` never populated, so fields are dead. |
| A7 | contract inconsistency | `routes.ts:14-29` vs `review-api.ts:59-61` | Shared Zod contract is REST source of truth | Route defines local `IntentResponse` instead of using `PrIntentRecord`. Client hook cannot reuse server-validated types. |

### Low severity

| ID | Smell | File:line | Rule | Consequence |
|----|---|---|---|---|
| A8 | import-path bypass | `service.ts:3` | Use @devdigest/shared alias | Imports via relative path `../../vendor/shared/contracts/brief.js`, duplicating alias import. Breaks if layout changes. |
| A9 | untyped boundary | `service.ts:52` | Typed feature-model id | `llmId as any` hides `provider/model` contract. |
| A11 | purity via ambient state | `logging/prompt-logger.ts:48,125` | Injected config, not env reads | Logger reads `process.env.DEBUG` directly. Env access is ambient global state; passing a `verbose` flag would be cleaner. |
| A12 | untrusted value outside wrapper | `prompt-builder.ts:128,133` | Wrap all PR-derived text | Path interpolated outside `wrapUntrusted`. Risk is low (charset limited by regex). |
| A13 | questionable truncation logic | `ref-resolver.ts:99-106` | Names match behavior | Document >32 KB cut to last 1 KB; name `TRUNCATE_THRESHOLD` misleads. |

### Checked & clean

- reviewer-core has no DB, FS, GitHub imports (purity maintained)
- Dependency direction correct: core ← server ← (client, GitHub, LLM, DB)
- Intent injection point: after PR description, wrapped untrusted, in trace
- INJECTION_GUARD covers intent and scope
- Prompt logging safe: lengths/sources/model only, no bodies
- Intent service fail-open, caches on SHA
- Module cohesion: intent/* grouped
- Contract mirroring: identical in server/client vendor/shared
- No import cycles found
- Client IntentBlock has no server imports

### Could not verify

- Actual `git diff main` (read code directly instead)
- Typecheck success (A1, A10 are suspects)
- `reviewer-core/src/review/run.d.ts` build artifact status
- DB migration field consistency with schema
- Client hook response typing (contract A7)

---

## 2. Security Review

**0 high-confidence findings (≥80%)**

4 uncertain findings below reporting threshold:

### Uncertain

| U# | Issue | Location | Control | Risk |
|----|---|---|---|---|
| U1 | No INJECTION_GUARD on intent classifier prompt | `prompt-builder.ts:36-96` | Output constrained by Zod, re-wrapped in review prompt, GUARD covers downstream | Impact limited to integrity of summary if PR body injects scope. Becomes CRITICAL if scope filter is wired (CWE-77). Fix: append GUARD to intent system prompt. |
| U2 | Weak wrapUntrusted escaping | `prompt.ts:33` | Only lowercase `</untrusted>` replaced; `</ UNTRUSTED>` passes through | Likely inert for LLM. Low exploitability (CWE-74). Fix: case-insensitive and trim. |
| U3 | llmId passed as provider id | `service.ts:52` | `container.llm(llmId as any)` passes `"openrouter/<model>"`, which doesn't match known provider | Routing fails, intent silently never derives (correctness bug, data-egress mismatch). Fix: call `llm(featureModel.provider)`. |
| U4 | No per-route rate limit on re-derive | `routes.ts:88` | Global 120/min; review route has 10/min. Cache per SHA, but failures uncached. | Medium-to-low availability issue (repeat failures trigger paid calls). Also runs in every review. Fix: add route-level rate limit, cache failures. |

### Checked & clean

1. **Prompt injection wrapping:** All external fields wrapped untrusted; diff hunk headers only; doc paths charset-constrained.
2. **ref-resolver:** Target repo from DB (no SSRF); path limited to `.md` files; API caps at 1 MB; docs capped 32 KB; files ≤100, hunks ≤2.
3. **Intent storage/UI:** Drizzle parameterized (no SQLi); React text nodes (no XSS); workspace check (no IDOR); Zod validation.
4. **Logging:** Only lengths/sources/model logged, never content.
5. **API keys:** From container.secrets, not config/client/prompt.
6. **Response validation:** IntentSchema validated; fail-open on error; confidence cap server-side.

---

## 3. Plan Verification Matrix

18 requirements from `docs/plans/intent-layer.md`. **Status: 0 PASS, 18 PARTIAL, 0 MISSING** (no tests, all gaps named).

| Req | Requirement | Status | Evidence | Gap |
|---|---|---|---|---|
| 1 | Flash model via OpenRouter, separate from review model | PARTIAL | `review_intent` feature-model slot, defaults `openrouter/google/gemini-2.5-flash-lite`, resolved separately | **BLOCKER A10**: curly-quote syntax error in platform.ts:53-55. No fallback to main model. No test. |
| 2 | Input: title, body, files+hunk headers, no diff bodies | PARTIAL | prompt-builder.ts:155-179 emits paths + first 2 hunk headers; caps files at 100, body at 2000 chars | No test. |
| 3 | Output: Intent {summary, in_scope, out_of_scope, confidence, sources, missing_context} | PARTIAL | brief.ts:15-24, validated via IntentSchema (service.ts:67-73) | `missing_context` optional not required. Legacy `intent` field remains. Contracts.test.ts likely fails. No test run. |
| 4 | Empty description: intent from files, confidence ≤0.4 | PARTIAL | service.ts:77-79 caps at 0.4, basis set to files_only; prompt rule at prompt-builder.ts:55,79-95 | Plan's "0.0 if no sources" not implemented. No test. |
| 5 | Plan/spec/ticket references; unavailable marked, not guessed | PARTIAL | ref-resolver.ts:36-54 (issue), :58-93 (plan/spec); status keys fetched/unavailable/error | **BLOCKERS**: No timeout/retry (plan requires 30s/3 retry). Truncation logic inverted (plan 64 KB → last 1 KB, code last 1 KB always). GitHub URL parsing absent. Status keys inconsistent. Plan says labels like "Plan at docs/spec.md", code stores LLM's own sources. No test. |
| 6 | Stored on PR, re-derivable | PARTIAL | repository.ts upserts (service.ts:91-98); cache keyed on derivedFromHeadSha === pull.headSha (service.ts:32); routes.ts:68 computes stale | **BLOCKER**: `derive` route returns cache when SHA matches, so manual re-derive never re-runs LLM. Per-PR 30s rate limit not implemented. No test. |
| 7 | Out-of-scope filtered, one signal for serious | PARTIAL | scopeFindings() at scope.ts:32-79, simpleScopeFindings at :87 | **BLOCKER**: Dead code, no callers. Judge call not in executor, no scope.judge step, findings not persisted with scope. Zero runtime filtering. No test. |
| 8 | Manual re-derive button | PARTIAL | IntentBlock.tsx:153-162 renders Button → useRederiveIntent | Button only visible when stale; plan shows it always. Hook invalidates query, but server returns cache (see req 6). No test. |
| 9 | DB schema: pr_intent extended, findings.scope added | PARTIAL | reviews.ts:46-47 adds scope/scopeReason, :50-72 adds summary/confidence/sources/etc; migration 0012:1-14 generated | **BLOCKER**: Migration line 4 `ADD COLUMN "summary" text NOT NULL` with no default, fails on non-empty table. Legacy `intent` column kept. No schema/snapshot test. |
| 10 | API: GET/POST /pulls/:id/intent | PARTIAL | GET at routes.ts:41-85 (404 if absent, stale computed, workspace check); POST at :88-165 (502 on error) | POST path `/intent/derive` (matches plan). No rate limit, no retry_after. 502 fires even though service swallows errors. No route test. |
| 11 | Settings: review_intent model override | PARTIAL | getFeatureModelOverride/resolveFeatureModel (feature-models.ts:36-57); listed in client feature-models.ts:22 | **BLOCKER A10** affects this too. No fallback. No test. |
| 12 | Server module: routes, service, repository, ref-resolver | PARTIAL | All exist in server/src/modules/intent/; prompt-builder in reviewer-core/src/intent/ | `readRepoFile` only on OctokitGitHubClient, not on GitHubClient interface. RefResolver/Service type mismatch (A1). |
| 13 | Prompt injection: intent section, wrapUntrusted | PARTIAL | prompt.ts:76 adds intent part, :189-191 renders through wrapUntrusted('intent', …); executor passes at run-executor.ts:254-256; prompt-builder.ts:105-139 wraps inputs | `intentText` built from summary/scope/confidence only (run-executor.ts:133). No test. |
| 14 | scopeFindings() collapses serious findings | PARTIAL | scope.ts:63-75 creates one signal for CRITICAL/security/secret_leak | **BLOCKER**: Not wired in (see 7). Signal created but "N findings" summary not produced. Dead `let signal` in simple fallback. No test. |
| 15 | UI: Intent card, confidence, sources, stale, re-derive button | PARTIAL | IntentBlock.tsx:25-167 with Skeleton/Error/Empty states, summary, in/out columns, source chips:116-132, ConfidenceNum:137, stale Badge:143, button:153; OverviewTab.tsx:5,16 mounts | Status labels (fetched/unavailable) not shown as text. Styles.ts presence not confirmed. Error onRetry reloads page. Findings-panel scope badge/suppressed label absent. No IntentBlock.test.tsx. |
| 16 | Hooks: useIntent, useRederiveIntent | PARTIAL | reviews.ts:222-240, query key ["pr-intent", prId], invalidates on success | Returns TanStack Query result, not {intent, isLoading, error}. No test. |
| 17 | i18n: brief.json + settings.json | PARTIAL | brief.json:13-26 has intent.* keys (label, inScope, outOfScope, confidence, sources, stale, rederive, fetched, unavailable, error, missingContext, emptyHint) | Scope.suppressed / scope.signal keys absent. Settings.json has no intent key. IntentBlock uses fallbacks, masking missing i18n. |
| 18 | Logging: safe, verbose mode, correlation ID | PARTIAL | logging/prompt-logger.ts:46-72 gates on DEBUG/logger.level, :100-127 logs sections only, safeLogPromptAssembly at :140; run-executor.ts:66-77 creates correlationId, :134-141 logs intent.derive step | intent.load, intent.resolve_refs, scope.judge steps not implemented. RunTrace has no intent_step/judge_step. Cost not summed into agent_runs.cost_usd. service.ts:103 logs raw error via console.warn. |

### Blockers (must fix before shipping)

1. **A10** curly-quote syntax error in `platform.ts:53-55` (both vendor copies) → compilation failure
2. **A6+7** scope filter dead code → scope filtering not wired into run.ts
3. **6** cache returns on same SHA → manual re-derive doesn't re-run LLM
4. **9** migration `summary NOT NULL` with no default → fails on non-empty table
5. **All** no tests added → PASS impossible

### Out-of-plan changes

- `reviewer-core/src/logging/prompt-logger.ts`: safe logging module (commit c7da2c0)
- `scope.ts:simpleScopeFindings`: fallback not in plan
- Intent legacy field and pr_intent column kept
- Brief.json extra keys: error, missingContext, emptyHint, confidence, sources
- run-executor.ts:271 adds intent to section count

---

## Recommendations

**Critical (before merge):**
- Fix A10 curly quotes in both platform.ts files (4 replacements)
- Fix migration 0012 line 4 (add DEFAULT or make NULL)
- Wire scope filter: call `scopeFindings()` in run.ts after grounding, drop "out" findings, collapse serious to signal
- Fix adapter coupling A1: `GitHubClient` interface must include `readRepoFile`, or accept dependency on concrete adapter

**High priority (for feature completion):**
- Add judge LLM call to run-executor after grounding (second LLM, step name `scope.judge`)
- Implement U3 fix: call `llm(featureModel.provider)` instead of `llmId as any`
- Add tests: routes.it.test.ts, prompt.test.ts (intent section), scope.ts caller test, IntentBlock.test.tsx, useIntent hook test
- Resolve A5: pass structured `Intent` type to prompt, not hand-built markdown string

**Medium priority (polish):**
- A2: DI container pattern for IntentService (avoid direct instantiation in run-executor)
- A3: Routes use IntentRepository consistently, not raw schema
- A4: Dedup model resolution
- A7: Use shared `PrIntentRecord` contract in routes
- U1: Add INJECTION_GUARD to intent classifier prompt
- U4: Add per-route rate limit to re-derive endpoint
- A8: Use @devdigest/shared alias in service.ts:3
- A13: Fix truncateDoc logic (rename or fix behavior)
- RunTrace: add intent_step and judge_step fields
- Cost accounting: sum intent + judge calls into agent_runs.cost_usd

---

## Key Files Reviewed

**Backend:**
- server/src/modules/intent/{routes,service,repository,ref-resolver}.ts
- server/src/modules/reviews/run-executor.ts
- server/src/db/schema/reviews.ts
- server/src/db/migrations/0012_overconfident_sister_grimm.sql
- server/.env.example

**Reviewer-core:**
- reviewer-core/src/intent/prompt-builder.ts
- reviewer-core/src/review/scope.ts
- reviewer-core/src/prompt.ts
- reviewer-core/src/logging/prompt-logger.ts

**Client:**
- client/src/app/repos/[repoId]/pulls/[number]/_components/IntentBlock/IntentBlock.tsx
- client/src/lib/hooks/reviews.ts
- client/messages/en/brief.json

**Contracts:**
- server/src/vendor/shared/contracts/{brief,findings,platform,trace}.ts
- client/src/vendor/shared/contracts/{brief,findings,platform,trace}.ts

---

## Methodology

- **Architecture:** Read code (Glob, Grep), no git diff, no Bash
- **Security:** Read code, traced data flow, checked controls, no exploit runs
- **Plan:** Read plan doc, mapped to code with Grep, no execution
- All agents read-only; no fixes applied per user request
