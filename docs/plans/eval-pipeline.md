# Plan: Eval Pipeline (SPEC-03)

Spec: `specs/03-eval-pipeline.md` (SPEC-03, rev 2, status `approved`). Branch: `l06-evals-ci` (stacked on PR #18).
Author: `implementation-planner` (read-only). The caller saves this as `docs/plans/eval-pipeline.md`.
Execution mode: **PENDING: the user decides** (see section 9). Recommendation: single-agent, with a report to the user after each wave.
Open decisions that need the user's acknowledgement before the phases that depend on them: A-1 (before P1), A-2 (before P4), A-3 (before P5), A-4 (before P9). See section 6.

## 0. Spec gate

- Status is `approved`. OQ-1..OQ-4 are resolved in rev 2:
  - OQ-1: strict precision.
  - OQ-2: additive edits to both vendored `eval-ci.ts` copies, plus a new run table created with `pnpm db:generate`.
  - OQ-3: a minimal private root `package.json` that calls `scripts/verify-l06.sh`. There is no `--with-integration` flag.
  - OQ-4: edit `client/src/vendor/ui/nav.ts`.
- The remaining `[NEEDS CLARIFICATION]` tags (OQ-5..OQ-17 and the NFR targets) have defaults, and the ACs are written against them. This plan applies these defaults:
  - OQ-5: current version only.
  - OQ-6: fragment only, with a neutral task line.
  - OQ-7: whole hunks; refuse a fragment above 32 KB.
  - OQ-8: concurrency 3, 120 s per case, at most 50 cases.
  - OQ-9: 8+ cases on Security Reviewer.
  - OQ-10: insert seeded cases only when the agent has no seeded-origin case.
  - OQ-11: seeded runs and decided findings in fixture mode only.
  - OQ-12: no case editing.
  - OQ-13: no single-case run and no "Run all agents".
  - OQ-14: run detail in a drawer.
  - OQ-15: no new CI job.
  - OQ-16: deltas against the previous finished run.
  - OQ-17: the spec path stays as it is.
- All 86 ACs are mapped to tasks (section 5).

## 1. Research findings (code facts the plan relies on)

### 1a. Contracts
- The two `eval-ci.ts` copies are **not** byte-identical today. The server copy has about 248 non-empty lines; the client copy has about 220. The client copy lacks `AgentManifest` and the `Provider`/`CiFailOn` imports.
- `AgentVersionConfig` exists only in the server `knowledge.ts` (`server/src/vendor/shared/contracts/knowledge.ts:273`). The client copy does not have it.
- `server/test/contracts-parity.test.ts` checks byte parity of `brief.ts`, `trace.ts` and `platform.ts` only.
- `EvalRun` (`knowledge.ts:58`) has non-nullable 0..1 metrics. `EvalCase.expected_output` is `unknown`. Both stay untouched.
- The client may import only **types** from `@devdigest/shared` (`client/INSIGHTS.md`: a runtime import breaks `next build`). Runtime constants must be mirrored locally and pinned with a parity test.

### 1b. DB
- `eval_cases` (`server/src/db/schema/eval.ts:7`): `owner_id` has no FK, and JSON columns `input_meta` / `expected_output` exist.
- `eval_runs` (`eval.ts:22`): one row per case, `case_id` FK with **`onDelete: 'cascade'`**. That contradicts AC-20 (past runs keep results after a case is deleted).
- There is no run-level record.

### 1c. Review engine (`reviewer-core/src/review/run.ts`)
- `reviewPullRequest(ReviewInput)` returns `allFindings` (grounded; with no `intentObj` the scope policy is inactive), `dropped: {finding, reason}[]`, `tokensIn`, `tokensOut` and `costUsd | null`.
- `selectMode`: a single-file diff is always single-pass (`run.ts:151-157`), so each case makes exactly one structured call. This answers the spec's research suggestion.
- The `@devdigest/reviewer-core` barrel re-exports `OpenRouterProvider` (`index.ts:86`), so the scorer must not import the barrel.

### 1d. Diff
- `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts:14`) keeps `raw`, but hunks carry no text. The fragment builder must slice the raw lines itself.
- `loadDiff` (`server/src/modules/reviews/diff-loader.ts:12`) tries `git diff` and falls back to the `pr_files` patches. The seed has patches for PR #482 (`seed.ts:268-372`).

### 1e. Missing provider key (AC-43)
- `container.llm()` throws `ConfigError('<X>_API_KEY is not configured')`, which maps to 500 `config_error` (`platform/container.ts:183-211`, `platform/errors.ts:37`).
- **Starting a PR review does not refuse.** `ReviewService.runReview` creates the `agent_runs` rows, returns 200, and the background run then fails with that message (`reviews/service.ts:103-138`, `run-executor.ts:433-435`). See A-2.

### 1f. Rate limit and errors
- The review route uses `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` (`reviews/routes.ts:29`).
- The global limiter is off when `nodeEnv === 'test'` (`app.ts:95`).
- Zod failures map to 422 (`app.ts:118`). A 400 must therefore come from the service (`server/INSIGHTS.md`, project-context precedent).
- `IdParams` is `z.string().uuid()`, so a non-UUID answers 422.

### 1g. Boot reaper
- `buildApp` awaits `ReviewService.reapStaleRuns()` before listening, and a failure is non-fatal (`app.ts:80-85`). The AC-47 reaper reuses this slot.

### 1h. Agents
- `AgentsRepository.deleteById` (`agents/repository.ts:77`) cascades versions and links only.
- `snapshotVersion` (`agents/repository.ts:175`) builds the config JSON inline. Extract it as a pure helper so the run manifest equals the snapshot (AC-33).
- `setSkills` does not bump the version.

### 1i. Concurrency and timeout helpers
- `mapLimit` already exists (`modules/project-context/map-limit.ts`). `withTimeout` and `TimeoutError` exist in `platform/resilience.ts:6-24`.

### 1j. Route unit-test pattern
- `server/test/project-context-routes.test.ts` builds the app with `db: {} as Db` and spies on `Repository.prototype` methods with an in-memory store. Routes can be tested without a DB.

### 1k. Seed and demo reset
- The seed's sample review has `agent_id = null` and `model = 'seed'`. Its findings are `src/config.ts:12` ("Hardcoded Stripe secret key") and `src/api/users.ts:45-52` (N+1), both undecided.
- `server.ts:13-23` runs `seed()` and then `resetDemoProject()` on every development boot. `resetDemoProject` **clears accept/dismiss marks** on the seed findings (`demo-reset.ts:61-64`).
- The fixture switch is `seed(db, { demoContext })`, which is true when `PROJECT_DOCS_SOURCE=fixture`. The e2e stack sets it (`scripts/e2e.sh:44`). `.github/workflows/e2e-web.yml` still lacks that line (`e2e/INSIGHTS.md`).
- The seeded agents are at version 1.

### 1l. Client
- `FindingCard` (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:104-125`) has only Accept and Dismiss in the expanded body.
- `FindingRecord` has `review_id` but no `agent_id`, so the draft endpoint must return the owner agent.
- `AgentEditor` `TABS` (`constants.ts:11`) are config, skills and context. Page `VALID_TABS` derives from `TABS` (client INSIGHTS).
- `activeKeyFor` already maps `/eval*` to the key `"eval"` (`components/app-shell/helpers.ts:35`). `icons.tsx` has `Gauge` and `FlaskConical`.
- An unused `client/messages/en/eval.json` (an older design namespace) exists. The spec asks for an `evals` namespace.
- A word-level LCS diff already exists in `client/src/app/skills/_components/SkillEditor/_components/VersionsTab/helpers.ts`.
- The vendored `Drawer` has no label, no Escape handling and no focus return. Use a feature-local dialog (SPEC-02 precedent).

## 2. Spec claims that do not match the code

1. **AC-82 "identical in both copies".** The `eval-ci.ts` copies already differ, and aligning them fully would pull CI contracts into the client (out of scope).
   - Plan: append one self-contained block delimited by `// ==== SPEC-03 eval pipeline: begin ====` / `// ==== SPEC-03 eval pipeline: end ====`.
   - The block imports nothing beyond `z`; enums are inlined as string literals.
   - The block is byte-identical in both copies, and the parity test compares the block.
   - This is A-1.
2. **AC-33 manifest = `AgentVersionConfig`.** The client has no `AgentVersionConfig`, so `EvalRunManifest` is defined inside the block with the same fields plus `skill_versions`.
3. **AC-43 "same status and message as starting a PR review".** A PR review start does not fail on a missing key; the run fails afterwards.
   - Plan: the eval start resolves `container.llm(provider)` **before** writing anything and lets the same `ConfigError` through (500 `config_error`, message `"<X>_API_KEY is not configured"`, the same message a failed review run shows).
   - This is A-2.
4. **AC-20 vs the `eval_runs.case_id` cascade.** The FK changes to nullable with `onDelete: 'set null'`, and each result stores a case snapshot.
5. **AC-14 / AC-42 / AC-44 "400".** Zod answers 422 in this app. The routes validate only the shape loosely; the service throws `AppError(…, 400)`. A non-UUID path id answers 422 (zod); an unknown id answers 404.
6. **AC-86 / AC-78 fixture data vs the demo reset.** Marks set by the seed are cleared by `resetDemoProject` on every dev boot. `resetDemoProject` must re-apply the fixture decision when `demoContext` is on.
7. **AC-78 "two versions".** The seeded agents are at v1. See A-3.
8. **AC-45 test.** The limiter is disabled under `NODE_ENV=test`. The test builds the app with `NODE_ENV=development` (no seed runs in `buildApp`).
9. **i18n.** Add a new `messages/en/evals.json` as the spec says. `eval.json` is left unchanged (unused; deleting it is out of scope).

## 3. Implementation strategy

### 3a. Contracts (P1)

Appended block in `contracts/eval-ci.ts`. It is identical in `server/src/vendor/shared/contracts/` and `client/src/vendor/shared/contracts/`, purely additive, and existing schemas are untouched.

Enums and constants:
- `EVAL_MAX_CASES_PER_RUN = 50`, `EVAL_RUN_CONCURRENCY = 3`, `EVAL_CASE_TIMEOUT_MS = 120_000`, `EVAL_FRAGMENT_MAX_BYTES = 32_768`, `EVAL_CASE_NAME_MAX = 80`.
- `EvalExpectationKind = z.enum(['must_find','must_not_flag'])`.
- `EvalCaseOrigin = z.enum(['accepted_finding','dismissed_finding','seeded'])`.
- `EvalSuiteRunStatus = z.enum(['running','completed','completed_with_errors','failed'])`.
- `EvalCaseResultStatus = z.enum(['pending','ok','error'])`.
- `EvalFindingMatch = z.enum(['tp','fp_zone','unlabeled'])`.

Case shapes:
- `EvalExpectation = {kind, file, start_line: int>=1, end_line: int>=1}`.
- `EvalCaseMeta = {origin, source_finding_id?, source_pr_id?, source_decision?: 'accepted'|'dismissed', seed_key?}` (stored in `input_meta`).
- `EvalCaseDraft = {finding_id, pr_id, agent_id: string|null, name, expectation, input_diff, origin, existing_cases: {agent_id, case_id}[]}`.
- `EvalCaseCreateInput = {agent_id, finding_id, name, expectation, input_diff, notes?}`. The service validates it and answers 400.
- `EvalCaseLastResult = {run_id, status: 'pass'|'fail'|'error', matched: int, kind, error: string|null}`.
- `EvalCaseView = {id, agent_id, name, expectation, input_diff, notes, origin, source_finding_id, source_pr_id, last_result: EvalCaseLastResult|null}`.

Run shapes:
- `EvalRunManifest`:
  - `provider: z.enum(['openai','anthropic','openrouter'])`, `model`, `system_prompt`, `output_schema: unknown.nullish`, `strategy: z.enum(['single-pass','map-reduce','auto'])`, `ci_fail_on: string`, `repo_intel: boolean`, `skills: string[]`.
  - `skill_versions: {id, name, version: int}[]`.
- `EvalRunCounts = {cases_scored, cases_passed, must_find_total, must_find_hit, must_not_flag_total, must_not_flag_violated, tp, fp_zone, fp_unlabeled, grounded, dropped, cases_errored}`, all ints.
- `EvalRunMetrics = {recall, precision, citation_accuracy}`, each `number.min(0).max(1).nullable()`.
- `EvalSuiteRun = {id, agent_id, agent_name?, agent_version, status, error: string|null, cases_total, cases_done, metrics, counts: EvalRunCounts|null, duration_ms|null, cost_usd|null, started_at, finished_at|null}`.
- `EvalResultFinding = {file, start_line, end_line, severity, category, title, match: EvalFindingMatch}`.
- `EvalDroppedFinding = {file, start_line, end_line, title, reason}`.
- `EvalCaseResult = {id, case_id: string|null, case_name, expectation, origin, status, pass: boolean|null, grounded: EvalResultFinding[], dropped: EvalDroppedFinding[], duration_ms|null, tokens_in|null, tokens_out|null, cost_usd|null, error|null}`.
- `EvalSuiteRunDetail = EvalSuiteRun.extend({manifest, results: EvalCaseResult[]})`.

Responses:
- `EvalRunStartResponse = {run_id}`.
- `EvalRunPage = {items: EvalSuiteRun[], next_cursor: string|null}`.
- `EvalOverview = {agents: {agent_id, name, model, version, latest: EvalSuiteRun|null, previous: EvalSuiteRun|null}[], recent: EvalSuiteRun[]}`.
- `EvalCompare = {a: EvalSuiteRunDetail, b: EvalSuiteRunDetail}`, where a is older by `started_at`.

Client mirror and parity:
- The client mirrors the constants it needs at runtime in `client/src/components/evals/constants.ts`.
- `client/src/test/contracts-evals.test.ts` pins the mirrored values against the vendored constants (type-level import in the test is fine under vitest).

### 3b. DB (P2, `server/src/db/schema/eval.ts`, then `pnpm db:generate`)

- **New `eval_suite_runs`** (the run batch):
  - Columns: `id`, `workspace_id` (FK cascade), `agent_id` (FK `agents.id` cascade), `agent_version int`, `manifest jsonb not null`, `status text enum`, `error text`, `cases_total int`, `recall` / `precision` / `citation_accuracy` (double, nullable), `counts jsonb`, `duration_ms int`, `cost_usd double`, `started_at` (default now), `finished_at`.
  - Indexes: `(agent_id, started_at)` and `(workspace_id, started_at)`.
  - **Partial unique index on `agent_id` WHERE `status = 'running'`.** This closes the AC-41 race in the DB.
- **`eval_runs`** (keeps its per-case role):
  - Add `suite_run_id` (FK `eval_suite_runs.id` cascade, nullable for legacy rows).
  - `case_id` becomes nullable with `onDelete: 'set null'`.
  - Add `status text default 'pending'`, `case_snapshot jsonb` (`{name, expectation, origin}`), `error text`, `tokens_in int`, `tokens_out int`.
  - `actual_output` holds `{grounded, dropped}`. The existing `pass`, `duration_ms` and `cost_usd` are reused.
- **`eval_cases`**: unique index on `(owner_id, (input_meta->>'source_finding_id'))`, created with `sql` in drizzle. This is the DB-level guard for AC-10; the service still checks first to return a clean 409.
- Run `pnpm db:generate`. Never hand-edit SQL or `meta/**`.

### 3c. Server module `server/src/modules/evals/` (onion: routes -> service -> repository; pure files have no IO)

| File | Kind | Role |
|---|---|---|
| `constants.ts` | pure | Re-exports the contract constants; `EVAL_TASK_LINE = 'Review the following change.'`; `EVAL_RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' }`. |
| `fragment.ts` | pure | `buildFragment(rawDiff, file, start, end)` → `{fragment} \| {error: 'not_in_diff' \| 'too_large'}`. Walks the raw lines and keeps the file header (`diff --git`, `---`, `+++`) plus every whole hunk (original `@@` header) whose new-side lines intersect the normalized range. `fragmentCovers(fragment, file, start, end)` is used for AC-14. |
| `matching.ts` | pure | `normalizePath` (strips one leading `./`), `normalizeRange`, `matches(finding, expectation)` (AC-24). |
| `scoring.ts` | pure | `scoreCase(expectation, grounded)` → `{pass, matchedCount, labels: EvalFindingMatch[]}`. `scoreRun(results)` → `{metrics, counts}`, skipping `error` results (AC-23..AC-30). Imports only `./matching.js` and `import type` from `@devdigest/shared`. |
| `finalize.ts` | pure | `finalizeRun(results)` → `{status, metrics, counts, durationMs, costUsd}` (cost is null if any cost is null) (AC-38). |
| `draft.ts` | pure | `draftFromFinding({finding, decision, rawDiff, agentId, existing})`: kind from decision, slugified name (at most 80 characters), fragment or a refusal (AC-4, AC-5, AC-11). |
| `validate.ts` | pure | `validateCaseInput(input)` → list of reasons (AC-14). |
| `manifest.ts` | pure | `buildManifest(agentRow, skillIds, enabledSkills)`. Uses the new `agents/helpers.ts#versionConfigOf(row, skillIds)` (also used by `snapshotVersion`) plus `skill_versions` (AC-33). |
| `runner.ts` | IO via an injected `LLMProvider` only | `runEvalCases({cases, manifest, skillBodies, llm, concurrency, timeoutMs, onResult, log})`. Uses `mapLimit` (concurrency 3). For each case it calls `withTimeout(reviewPullRequest({systemPrompt, model, strategy, skills, diff: parseUnifiedDiff(case.input_diff), llm, task: EVAL_TASK_LINE}), 120000)` with **no** prDescription, intent, repoMap, callers, projectContext or memory. A `checkCancelled` throws after the timeout so map-reduce stops. On `TimeoutError` the error is `"timeout"`. Other errors become sanitized messages (first line, provider keys redacted, at most 300 characters). The result is mapped to `EvalCaseResult` with `scoreCase`. It never touches the DB. |
| `log-lines.ts` | pure | `runStartLine({agent, version, cases, model})`, `runEndLine({status, metrics, durationMs, cost})`, `caseErrorLine(caseId, reason)`. These lines never take fragment or model text (AC-48). |
| `repository.ts` | DB | Cases: `findFindingWithContext(ws, findingId)` (finding → review → pull → repo, workspace-scoped), `listCases(ws, agentId)` with the last result, `insertCase`, `deleteCase`, `existingCasesForFinding`, `countCases`. Runs: `createSuiteRun` (+ pending `eval_runs` rows in one transaction), `findRunningRun`, `saveCaseResult`, `finishSuiteRun`, `listRuns(ws, agentId, cursor, limit)`, `getRunDetail(ws, id)`, `overview(ws)`, `reapInterrupted()`, `deleteForAgent(agentId)`. |
| `service.ts` | IO | Draft, create, list, delete; `startRun` (validate → `container.llm(provider)` → snapshot → create rows → `void executeInBackground`); `executeInBackground` (runner → save each result → `finalizeRun` → finish → log lines); `listRuns`, `getRun`, `overview`, `compare`, `reapInterrupted`. |
| `routes.ts` | HTTP | Listed below. Registered in `modules/index.ts`. |

Routes. Every handler uses `getContext` → `workspaceId`. A foreign or unknown id answers 404 (AC-79, AC-80).

| Method and path | Response | Notes |
|---|---|---|
| `GET /findings/:id/eval-case-draft` | `EvalCaseDraft` | No writes (AC-3). Refusal → 422 `{code: 'finding_not_in_diff', message: "The finding's lines are no longer in the PR diff"}`. Too large → 422 `fragment_too_large`. Undecided finding → 409 `finding_undecided`. |
| `POST /eval-cases` | 201 `EvalCaseView` | Body parsed loosely. Invalid → 400 `invalid_eval_case` with reasons. Duplicate → 409 `eval_case_exists` with `{case_id}`. |
| `GET /agents/:id/eval-cases` | `EvalCaseView[]` | Ordered by kind, then name (AC-17; the client also sorts). |
| `DELETE /eval-cases/:id` | `{ok: true}` | |
| `POST /agents/:id/eval-runs` | 202 `EvalRunStartResponse` | Rate limit 10 per minute. Error cases below. |
| `GET /agents/:id/eval-runs?cursor&limit` | `EvalRunPage` | `limit` defaults to 20, max 50. Newest first. |
| `GET /eval-runs/compare?a=&b=` | `EvalCompare` | 400 `runs_not_comparable` if the two runs belong to different agents. |
| `GET /eval-runs/:id` | `EvalSuiteRunDetail` | |
| `GET /evals/overview` | `EvalOverview` | `recent` holds 6 runs. |

Error cases for `POST /agents/:id/eval-runs`, in this order, each with no rows written:
1. 0 cases → 400 "No eval cases for this agent".
2. More than 50 cases → 400 "Too many eval cases (limit 50)".
3. A run is already running → 409 `eval_run_running` with `details.running_run_id`.
4. Missing key → `ConfigError` passes through.

Wiring:
- `app.ts` adds `await new EvalsService(container).reapInterrupted()` next to `reapStaleRuns` in its own non-fatal try/catch (AC-47).
- `AgentsService.delete` calls `EvalsRepository.deleteForAgent(id)` in the same transaction as `deleteById`. Cases have no FK; runs cascade through the `agents` FK (AC-22).

Data flow of one run:
1. Route.
2. `startRun`.
3. Read the agent and its linked enabled skills; build the manifest.
4. Resolve the LLM provider (fails early).
5. Create the `running` suite row plus one pending row per case, with case snapshots.
6. Answer 202.
7. In the background: `runEvalCases` → `saveCaseResult` per case. The `cases_done` count comes from rows whose status is not pending.
8. `finalizeRun` → `finishSuiteRun`.
9. Write the start and end log lines.

Skill bodies are captured in memory at start, so a later edit cannot reach the running run (AC-33). No `agent_runs`, `run_traces`, `reviews` or `findings` rows are written (AC-46).

### 3d. Seed (P5)

`server/src/db/fixtures/eval-cases.ts` (pure data, no DB imports) exports `SEED_EVAL_CASES`: 9 cases on Security Reviewer, each with a self-contained single-file fragment and a `seed_key`.
- 5 `must_find` cases:
  - `hardcoded-stripe-key` (`src/config.ts:12`, origin `accepted_finding`, linked to the seeded finding).
  - `ssrf-webhook-url` (`src/api/public/webhooks.ts`).
  - `missing-retry-after` (`src/middleware/ratelimit.ts`).
  - `service-role-key-in-client`.
  - `sql-string-concat`.
- 4 `must_not_flag` cases:
  - `unused-import`.
  - `raw-body-parser-verified-webhook`.
  - `clean-refactor-rename`.
  - `n-plus-one-user-list` (origin `dismissed_finding`, linked to the seeded N+1 finding).

The module also exports:
- `SEED_EVAL_RUNS` (fixture mode): two finished runs with fixed case results.
  - Run v1: recall 0.6, precision about 0.5.
  - Run v2: recall 0.8, precision about 0.67.
  - One case regressed and two fixed, so compare shows every group.
- `SEED_EVAL_PROMPT_V2_SUFFIX`.

`seed.ts`:
- Inserts the seeded cases only when Security Reviewer has no case with `input_meta.origin = 'seeded'` or a `seed_key` (OQ-10).
- In fixture mode (A-3), it also marks the Stripe finding accepted, bumps Security Reviewer to v2 with the suffix prompt and a snapshot (only if still v1 and no seeded runs exist), and inserts the two runs with fixed ids `SEED_EVAL_RUN_V1_ID` / `SEED_EVAL_RUN_V2_ID`.
- `resetDemoProject(db, {demoContext})` re-applies the Stripe acceptance after clearing marks. `server.ts` passes the flag.

### 3e. Client

Hooks in `client/src/lib/hooks/evals.ts`, re-exported from `hooks/index.ts`:
- `useEvalCaseDraft(findingId, {enabled})`, `useCreateEvalCase`, `useAgentEvalCases`, `useDeleteEvalCase`.
- `useStartEvalRun`.
- `useAgentEvalRuns(agentId)`: an infinite query, 20 per page. `refetchInterval: 2000` while any item is `running` (AC-50 requires 3 s or less). When the last running run finishes, it invalidates the cases and overview queries.
- `useEvalRun(id)`, `useEvalOverview`, `useEvalCompare(a, b)`.

Shared feature components in `client/src/components/evals/` (kebab folder, barrel, colocated `constants.ts` / `helpers.ts` / `styles.ts`):
- `helpers.ts`:
  - `formatPct`, `deltaPt` (returns ▲/▼ plus points), `nullReason(metric, counts)`, `caseResultLabel` and `caseResultDetail` (e.g. "expected ≥1 matching finding, got 0").
  - `sortCases`, `latestFinished`, `previousFinished`, `versionDrift`.
  - `orderPair(a, b)` (older run first), `caseChanges(a, b)` (regressed / fixed / errored / unchanged / onlyA / onlyB, keyed by `case_id`, falling back to the snapshot name), `manifestDiff(a, b)`.
  - `diffWords`: re-exported from a new `client/src/lib/text-diff.ts`, extracted from `VersionsTab/helpers.ts`, which then imports it. The VersionsTab tests must stay green.
- Components:
  - `MetricStrip`: the three metrics plus "Cases passed", deltas, null tooltips, drift notice, and "No eval runs yet".
  - `ScoringNote`: the note plus a `<details>` "How metrics are computed".
  - `RunEvalControl`: button, confirm dialog, "Running k / N cases" (`role="status"`), errors (`role="alert"`).
  - `RunsTable`: checkboxes named with run time and version, Load more.
  - `RunDetailDrawer`: a labeled dialog that handles Escape and returns focus.
  - `CompareRunsDialog`.
- All case and finding text renders as plain text nodes, and fragments go in `<pre>` (AC-83).

Feature screens:
- **FindingCard**: a new `TurnIntoEvalCase` button in the actions row. It is disabled with the hint when undecided. The local state opens `EvalCaseDialog`, a new sibling folder `pulls/[number]/_components/EvalCaseDialog/`. The dialog uses `useEvalCaseDraft` and `useAgents` for the picker. On success it shows a toast "Eval case saved" with a link to `/agents/<id>?tab=evals`.
- **Agent editor**: add a `TABS` entry `{key: 'evals', labelKey: 'editor.tabs.evals', icon: 'FlaskConical'}` and the folder `_components/EvalsTab/`. The tab has a header with badges, `MetricStrip`, `ScoringNote`, `RunEvalControl`, the case list with delete confirm, the last 10 runs, and the "View full dashboard" link.
- **Dashboard**:
  - `client/src/app/evals/page.tsx` → `_components/EvalOverview/`: the agents table and the 6 recent runs.
  - `client/src/app/evals/[agentId]/page.tsx` → `_components/AgentEvalPage/`: agent switcher, "All agents", metric cards, `RunEvalControl`, `RunsTable`, Compare, `RunDetailDrawer`.
- **Nav**: `nav.ts` gets `{key: 'eval', label: 'Eval Dashboard', icon: 'Gauge', href: '/evals', gKey: 'e'}` as the last SKILLS LAB item, plus a `SHORTCUTS` entry for `g e`.
- **i18n**:
  - New `messages/en/evals.json`, with plurals for cases and runs.
  - `prReview.json` keys `finding.turnIntoEvalCase`, `finding.turnIntoEvalCaseHint`, `evalCaseDialog.*`.
  - `agents.json` key `editor.tabs.evals`.

## 4. Phases and tasks

Each task lists its ACs and the named test(s). Paths are relative to the repo root.

### P1: Contracts (alone, first)
- [x] **T1** Append the SPEC-03 block (section 3a) to `server/src/vendor/shared/contracts/eval-ci.ts` and the byte-identical block to `client/src/vendor/shared/contracts/eval-ci.ts`. Do not touch existing schemas. -> AC-81, AC-82 -> `server/test/contracts.test.ts > eval pipeline: legacy EvalCase/EvalCaseInput/EvalRun/EvalRunRecord/EvalDashboard fixtures still parse`, `> EvalSuiteRunDetail/EvalOverview/EvalCompare parse; metrics accept null`
- [x] **T2** Extend `server/test/contracts-parity.test.ts` with the marker-block comparison for `eval-ci.ts` (it fails if a marker is missing or the blocks differ). Add `client/src/components/evals/constants.ts` (mirrored limits) and `client/src/test/contracts-evals.test.ts`. -> AC-82 -> `contracts-parity.test.ts > eval-ci.ts SPEC-03 block byte-identical`; `contracts-evals.test.ts > client copy parses fixtures; mirrored constants equal vendored`
- Gate: `pnpm typecheck` in `server`, `client` and `reviewer-core`.

### P2: DB schema and migration (after P1)
- [x] **T3** Edit `server/src/db/schema/eval.ts` (section 3b) and run `pnpm db:generate`. Check the generated SQL for the partial unique index and the expression index. If drizzle-kit cannot emit the expression index, drop it and rely on the service check plus a transaction (record the fallback in INSIGHTS). -> AC-20, AC-22, AC-41, AC-10 -> covered by the T13/T14 integration tests.
- [x] **T4** Add `agents/helpers.ts#versionConfigOf(row, skillIds)`. `snapshotVersion` uses it (no behaviour change). -> AC-33 -> `server/test/eval-manifest.test.ts > versionConfigOf equals the snapshot shape` (plus the existing `agents-versions.it.test.ts` stays green).

### P3: Pure scoring and helpers (after P1; parallel with P2)
- [ ] **T5** `matching.ts` and `scoring.ts`. -> AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-30 -> `server/test/eval-scoring.test.ts`:
  - `> match table: 10–12 vs 12–15 match; 10–11 vs 12–15 no; reversed range matches; other file no; ./src/a.ts == src/a.ts; src/A.ts != src/a.ts`
  - `> must_find pass with 1 and 2 matches, fail with 0; must_not_flag inverse`
  - `> recall 3/4 = 0.75; double match counts once; zero must_find -> null`
  - `> precision fixture A{match,match,unlabeled} B{zone,unlabeled} -> TP2 FPz1 FPu2 = 0.4; no grounded -> null`
  - `> citation 6 kept 2 dropped -> 0.75; 0/0 -> null`
  - `> error results excluded from every count`
  - `> metrics recomputable from counts`
  - `> case B on same file/overlap not hit by case A findings`
  - `> spy provider passed alongside: zero calls`
- [ ] **T6** Purity guard. -> AC-23 -> `server/test/eval-scoring-purity.test.ts > import graph of scoring.ts (recursive, relative) contains no reviewer-core/src/llm, adapters/llm, @devdigest/reviewer-core barrel, openai, @anthropic-ai/sdk; only type imports from @devdigest/shared`
- [ ] **T7** `fragment.ts` and `draft.ts`. -> AC-4, AC-5, AC-11, AC-6 (default name) -> `server/test/eval-fragment.test.ts`:
  - `> two-hunk file, finding in 2nd hunk -> exactly that hunk with original @@ header; reparse yields same new-side numbers`
  - `> range spanning two hunks -> both`
  - `> no intersecting hunk -> not_in_diff`
  - `> > 32 KB -> too_large`

  `server/test/eval-draft.test.ts`:
  - `> accepted -> must_find, dismissed -> must_not_flag; file/start/end copied`
  - `> name slug <= 80 chars`
  - `> refusal message text`
- [ ] **T8** `validate.ts`. -> AC-14 -> `server/test/eval-validate.test.ts > empty name / bad kind / start<1 / end<start / empty fragment / unparsable / file absent / range outside hunks -> one reason each`
- [ ] **T9** `finalize.ts` and `log-lines.ts`. -> AC-38, AC-48 -> `server/test/eval-finalize.test.ts > all ok -> completed; some error -> completed_with_errors; all error -> failed, metrics null; cost null if any case null; durations summed`; `server/test/eval-log-lines.test.ts > start/end/error formats; no fragment parameter exists`

### P4: Runner, repository, service, routes (after P2 + P3; fake LLMProvider only)
- [ ] **T10** `manifest.ts` and `runner.ts`. Add the test helper `server/test/helpers/recording-llm.ts`, a provider that records requests and returns scripted findings, with a delay and throw-per-case options. -> AC-33, AC-34, AC-35, AC-36, AC-37, AC-39, AC-40, AC-48 -> `server/test/eval-runner.test.ts`:
  - `> messages contain fragment + system prompt; no PR description/intent/repo map/callers/project context/memory sections; snapshot of messages for fixture case`
  - `> sentinel name/notes/expectation never in any message`
  - `> two manifests, same cases -> user-message content byte-identical`
  - `> result has grounded (file, lines, severity, category, title), dropped with reason, pass, duration, tokens, cost`
  - `> stub throws for 1 of 3 -> 2 ok, 1 error with sanitized message, others continue`
  - `> max concurrent calls == 3`
  - `> fake timers: 120 s -> error "timeout"`
  - `> captured log lines contain no fragment sentinel`
- [ ] **T11** `repository.ts`, plus the in-memory `server/test/helpers/fake-eval-store.ts` (repository prototype spies, the project-context-routes pattern). -> AC-79, AC-80 -> covered by T12/T13.
- [ ] **T12** `service.ts`, `routes.ts`, and registration in `modules/index.ts`. -> AC-3, AC-8, AC-10, AC-11, AC-14, AC-32, AC-41, AC-42, AC-43, AC-44, AC-45, AC-79, AC-80, AC-81 -> `server/test/evals-routes.test.ts` (`db: {} as Db`, fake store, recording LLM override):
  - `> draft writes nothing (store write spies 0)`
  - `> draft 422 not-in-diff message`
  - `> create invalid -> 400 per reason, row count unchanged`
  - `> duplicate -> 409, unchanged`
  - `> POST eval-runs -> 202 + running run + N pending results, response before delayed provider resolves`
  - `> running run -> 409 with running_run_id, nothing created`
  - `> 0 cases -> 400 "No eval cases for this agent"`
  - `> 51 cases -> 400 naming 50`
  - `> no key -> config_error, same message as container.llm, zero rows`
  - `> NODE_ENV=development limiter -> 429 after 10`
  - `> other-workspace agent/case/run/finding -> 404 on every endpoint, no other reads/writes`
  - `> unknown uuid -> 404; non-uuid -> 422`
  - `> compare runs of different agents -> 400`
  - `> each endpoint response parses against its contract`
- [ ] **T13** Boot reaper in `app.ts` and agent-delete cleanup in `AgentsService.delete`. -> AC-22, AC-47 -> covered by T14.
- [ ] **T14** DB integration tests in `server/test/evals.it.test.ts` (testcontainers, recording LLM). -> AC-8, AC-12, AC-20, AC-22, AC-29, AC-33, AC-37, AC-38, AC-46, AC-47 ->
  - `> create stores row + meta (source finding, PR, decision)`
  - `> delete source PR, run still executes the case`
  - `> delete case: past run results/metrics unchanged (case_id null, snapshot kept)`
  - `> delete agent -> no cases/suite runs/results`
  - `> stored counts match fixture`
  - `> edit prompt mid-run (delayed stub) -> all cases saw original prompt, manifest unchanged`
  - `> stored case results`
  - `> three outcomes persisted`
  - `> agent_runs/run_traces/reviews/findings counts unchanged`
  - `> inserted running run -> buildApp -> failed "interrupted", finished results kept`

### P5: Seed and experiment (after P4)
- [ ] **T15** `server/src/db/fixtures/eval-cases.ts`. -> AC-73 -> `server/test/eval-seed-fixture.test.ts > >= 8 cases, >= 3 per kind; every fragment parses and its range intersects a hunk of its file; derived cases carry origin, others "seeded"; seeded runs parse as EvalSuiteRunDetail and their stored metrics equal scoreRun(results)`
- [ ] **T16** `seed.ts`: cases (idempotent, OQ-10). In fixture mode: the Stripe finding accepted, Security Reviewer at v2 (A-3), the two runs. `demo-reset.ts` re-applies the fixture decision, and `server.ts` passes `demoContext`. -> AC-73, AC-74, AC-78, AC-86 (data) -> `server/test/seed-demo.it.test.ts > seeds >= 8 eval cases; second seed adds none; deleted seeded case not re-created; fixture on -> 2 runs at v1/v2, Stripe finding accepted after resetDemoProject; fixture off -> no runs, no decisions`
- [ ] **T17** `server/test/helpers/prompt-aware-llm.ts`, a fake whose output depends on a system-prompt marker:
  - GOOD: findings on the `must_find` ranges.
  - BROKEN: one finding on every added line, including `must_not_flag` zones.
  - SILENT: no findings.

  Then add `server/test/eval-experiment.test.ts`. -> AC-75 -> `> precision(BROKEN) < precision(GOOD) on seeded cases; recall(SILENT) != recall(GOOD); zero DB/network`

### P6: Client foundation and capture (after P1; connect after P4)
- [ ] **T18** Hooks `client/src/lib/hooks/evals.ts`. -> AC-50, AC-62 -> `client/src/lib/hooks/evals.test.tsx > polls every 2 s while a run is running, stops after; invalidates cases + overview on finish; runs pages of 20`
- [ ] **T19** `client/src/lib/text-diff.ts` (extracted) and `client/src/components/evals/helpers.ts` + `constants.ts`. -> AC-17, AC-51, AC-52, AC-54, AC-67, AC-69, AC-70, AC-71 -> `client/src/components/evals/helpers.test.ts`:
  - `> formatPct/deltaPt 0.75 -> 0.88 = "▲ 13pt", decrease "▼"`
  - `> nullReason texts`
  - `> sortCases kind then name`
  - `> orderPair older first`
  - `> caseChanges 8 cases: 1 regressed 2 fixed; onlyA/onlyB`
  - `> manifestDiff model/strategy/skills added/removed/version change`
  - `> diffWords marks one changed sentence`

  The existing `VersionsTab` tests stay green.
- [ ] **T20** FindingCard action and `EvalCaseDialog`; `prReview.json` keys. -> AC-1, AC-2, AC-3, AC-6, AC-7, AC-8, AC-9, AC-10, AC-13, AC-83 -> `FindingCard.test.tsx > accepted and dismissed: "Turn into eval case" enabled; undecided: disabled + "Accept or dismiss the finding first"`; `EvalCaseDialog/EvalCaseDialog.test.tsx`:
  - `> opens with draft, no create request`
  - `> fields: editable name, kind radio switchable, read-only file/range, monospaced fragment, owner agent, notes`
  - `> dismissed hint text`
  - `> save payload + "Eval case saved" + link to ?tab=evals`
  - `> agent_id null -> Save disabled until agent picked`
  - `> existing case for chosen agent -> "Already an eval case" link, no Save`
  - `> failing mutation -> dialog stays open with edits + error`
  - `> <img onerror> in name/fragment not in DOM`

### P7: Client Evals tab (after P6)
- [ ] **T21** Shared `MetricStrip`, `ScoringNote`, `RunEvalControl`. -> AC-28 (tooltip), AC-31, AC-49, AC-50, AC-51, AC-52, AC-53, AC-54, AC-56, AC-57 -> `client/src/components/evals/MetricStrip/MetricStrip.test.tsx`:
  - `> "88%" "▲ 13pt"; "▼"`
  - `> null -> "—" with reason tooltip, no delta`
  - `> no finished run -> "No eval runs yet"`
  - `> run v3 agent v4 -> drift notice`
  - `> citation tooltip "grounding pass rate"`

  `ScoringNote.test.tsx > note + disclosure text with three formulas and limits`

  `RunEvalControl.test.tsx`:
  - `> confirm text "Run 9 cases with <model>? …", Cancel sends nothing, Run sends one POST`
  - `> running: "Running 3 / 9 cases", disabled, role=status`
  - `> 400/missing key/network -> message + re-enabled; 409 -> shows running progress`
- [ ] **T22** `EvalsTab`, the `TABS` entry, and `agents.json`/`evals.json` keys. -> AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-50, AC-53, AC-55, AC-83 -> `AgentEditor.test.tsx > renders Evals tab`; `client/src/app/agents/[id]/page` deep-link test `> ?tab=evals opens Evals`; `EvalsTab/EvalsTab.test.tsx`:
  - `> mixed fixture rows: result icon + label, name, kind badge text, origin, file:start–end, detail`
  - `> order`
  - `> "6 / 8 passing" and "9 cases"`
  - `> empty state text + Run disabled`
  - `> delete confirm then request`
  - `> loading placeholder; error + Retry`
  - `> polling completion refreshes strip, rows, history`
  - `> 12 runs -> 10 rows + link /evals/<agentId>`
  - `> hostile case name plain text`

### P8: Client dashboard, compare, nav (after P7)
- [ ] **T23** `nav.ts` entry and shortcut. -> AC-58 -> `client/src/test/nav-evals.test.tsx > SKILLS LAB has "Eval Dashboard" after Conventions, href /evals, icon Gauge; activeKeyFor("/evals/x") === "eval"`
- [ ] **T24** `EvalOverview` landing (`/evals`). -> AC-59, AC-60, AC-64, AC-31 -> `EvalOverview.test.tsx`:
  - `> agent with runs (version, time, "X/Y pass", three %) and without ("No eval runs yet")`
  - `> 6 recent rows newest first; row/agent click -> /evals/<id>`
  - `> no agents -> "No agents yet" + link; loading; error + Retry`
  - `> scoring note present`
- [ ] **T25** `AgentEvalPage` (`/evals/[agentId]`) with `RunsTable` and `RunDetailDrawer`. -> AC-61, AC-62, AC-63, AC-65, AC-66 -> `AgentEvalPage.test.tsx`:
  - `> name/model, metric cards with deltas, Run eval control, table columns`
  - `> 25 runs -> 20 + Load more`
  - `> switcher + "All agents"; agent id from URL`
  - `> checkbox names include time + version`
  - `> select 1/2/3 -> Compare enabled only at 2; third replaces earliest; hint text`

  `RunDetailDrawer.test.tsx > per-case name, kind, pass/fail/error, matched + unlabeled file:lines, dropped with reason, error message`
- [ ] **T26** `CompareRunsDialog`. -> AC-67, AC-68, AC-69, AC-70, AC-71, AC-72 -> `CompareRunsDialog.test.tsx`:
  - `> newer selected first -> "Compare runs · v1 → v2", A older left`
  - `> recall/precision/citation/cost cells A, B, delta with ▲/▼, "—" for null`
  - `> prompt diff: removed with strikethrough, added with underline, "System prompt unchanged" when equal; model line`
  - `> Regressed/Fixed/Errored groups + unchanged count`
  - `> case sets differ notice with N/M and separate lists`
  - `> labeled dialog, Escape closes, focus returns to Compare`

### P9: e2e (after P5 + P8; fixture mode, read-only, no LLM)
- [ ] **T27** `e2e/specs/12-agent-evals-tab.flow.json`. Open Security Reviewer `?tab=evals`; assert at least 8 `[data-testid="eval-case-row"]`, both "must find" and "must not flag" badges, and the strip values of the seeded v2 run. -> AC-84
- [ ] **T28** `e2e/specs/13-eval-dashboard-compare.flow.json`. Sidebar "Eval Dashboard" → Security Reviewer → tick both seeded runs → Compare; assert the title, a "▲" delta, and an `ins` or `del` prompt mark. Never click Run. -> AC-85, AC-58
- [ ] **T29** `e2e/specs/14-turn-into-eval-case.flow.json`. PR #482 → Agent runs → expand the Stripe finding → "Turn into eval case"; assert "Must find" selected, `src/config.ts`, lines 12; Cancel. -> AC-86
- [ ] **T30** Update `e2e/README.md` and `e2e/specs/flows.md` (flows 12-14 need `PROJECT_DOCS_SOURCE=fixture`; A-4). -> AC-84, AC-85, AC-86 -> review only.

### P10: `pnpm verify:l06` (after P5; can run alongside P6-P9)
- [ ] **T31** Root `package.json`: `{"name": "devdigest-root", "private": true, "scripts": {"verify:l06": "bash scripts/verify-l06.sh"}}`. No dependencies, no `pnpm-workspace.yaml`, no lockfile.

  `scripts/verify-l06.sh` (`set -euo pipefail`):
  1. Unset `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`.
  2. Fail fast with "run pnpm install in <pkg>" if any `node_modules` is missing. It never installs.
  3. `step "<name>" <cmd>` prints the step and, on failure, `verify:l06 FAILED at step: <name>` and exits with that code.

  Steps:
  1. server typecheck
  2. server unit (`pnpm exec vitest run --exclude '**/*.it.test.ts'`)
  3. client typecheck
  4. client test
  5. reviewer-core typecheck
  6. reviewer-core test
  7. seed fixture (`vitest run test/eval-seed-fixture.test.ts`)
  8. scorer purity (`eval-scoring.test.ts`, `eval-scoring-purity.test.ts`)
  9. experiment (`eval-experiment.test.ts`)

  -> AC-76, AC-77 -> manual: green run; temporarily break an assertion in `eval-scoring.test.ts` and confirm a non-zero exit naming "server unit"; run with Wi-Fi off and no keys.

### P11: Docs and INSIGHTS (last)
- [ ] **T32** `server/README.md` (eval routes, scoring formulas, limits), `client/README.md` (Evals tab and dashboard routes), `reviewer-core/specs/review-contract.md` (a note that evals call `reviewPullRequest` with fragment-only inputs), `docs/` scoring note "citation_accuracy = grounding pass rate". Run the `engineering-insights` pass on `server/`, `client/` and `e2e/` INSIGHTS. -> AC-31, AC-82 (documentation) -> review only.

## 5. Traceability matrix (AC -> task -> test)

| AC | Tasks | Tests |
|---|---|---|
| AC-1 | T20 | FindingCard.test (enabled for accepted/dismissed) |
| AC-2 | T20 | FindingCard.test (disabled + hint) |
| AC-3 | T12, T20 | evals-routes.test (draft writes nothing), EvalCaseDialog.test (no create) |
| AC-4 | T7 | eval-draft.test (kind/file/range) |
| AC-5 | T7 | eval-fragment.test (2nd hunk, original header, same numbers) |
| AC-6 | T7, T20 | eval-draft.test (slug <= 80), EvalCaseDialog.test (fields, kind switch) |
| AC-7 | T20 | EvalCaseDialog.test (dismissed hint) |
| AC-8 | T12, T14, T20 | EvalCaseDialog.test (payload, confirmation), evals.it.test (row + meta) |
| AC-9 | T20 | EvalCaseDialog.test (agent_id null) |
| AC-10 | T3, T12, T20 | evals-routes.test (409 unchanged), EvalCaseDialog.test (Already an eval case) |
| AC-11 | T7, T12 | eval-fragment.test (not_in_diff), eval-draft.test (message), evals-routes.test (422, no write) |
| AC-12 | T14 | evals.it.test (source PR deleted, case runs) |
| AC-13 | T20 | EvalCaseDialog.test (failing mutation) |
| AC-14 | T8, T12 | eval-validate.test, evals-routes.test (400 per reason) |
| AC-15 | T22 | AgentEditor.test, page deep-link test |
| AC-16 | T22 | EvalsTab.test (row elements) |
| AC-17 | T19, T22 | helpers.test (sortCases), EvalsTab.test (order) |
| AC-18 | T22 | EvalsTab.test (6 / 8 passing, 9 cases) |
| AC-19 | T22 | EvalsTab.test (empty state, Run disabled) |
| AC-20 | T3, T14, T22 | EvalsTab.test (confirm + request), evals.it.test (results kept) |
| AC-21 | T22 | EvalsTab.test (loading, error + Retry) |
| AC-22 | T3, T13, T14 | evals.it.test (agent delete) |
| AC-23 | T5, T6, T31 | eval-scoring.test (spy zero calls), eval-scoring-purity.test, verify:l06 |
| AC-24 | T5 | eval-scoring.test (match table) |
| AC-25 | T5 | eval-scoring.test (per kind 0/1/2) |
| AC-26 | T5 | eval-scoring.test (0.75, counts once, null) |
| AC-27 | T5 | eval-scoring.test (0.4, null) |
| AC-28 | T5, T21 | eval-scoring.test (0.75, null), MetricStrip.test (tooltip) |
| AC-29 | T5, T14 | eval-scoring.test (recomputable), evals.it.test (stored counts) |
| AC-30 | T5 | eval-scoring.test (case B not hit) |
| AC-31 | T21, T24, T32 | ScoringNote.test, EvalOverview.test (note) |
| AC-32 | T12 | evals-routes.test (202, pending rows, before provider) |
| AC-33 | T4, T10, T14 | eval-manifest.test, evals.it.test (mid-run edit) |
| AC-34 | T10 | eval-runner.test (sections absent, snapshot) |
| AC-35 | T10 | eval-runner.test (sentinels absent) |
| AC-36 | T10 | eval-runner.test (byte-identical user content) |
| AC-37 | T10, T14 | eval-runner.test (result fields), evals.it.test (stored) |
| AC-38 | T9, T14 | eval-finalize.test (three outcomes, cost null), evals.it.test |
| AC-39 | T10 | eval-runner.test (1 of 3 throws) |
| AC-40 | T10 | eval-runner.test (max 3 concurrent, timeout) |
| AC-41 | T3, T12 | evals-routes.test (409 running id) |
| AC-42 | T12 | evals-routes.test (400 no cases) |
| AC-43 | T12 | evals-routes.test (config_error, zero rows) |
| AC-44 | T12 | evals-routes.test (51 cases) |
| AC-45 | T12 | evals-routes.test (429) |
| AC-46 | T14 | evals.it.test (table counts unchanged) |
| AC-47 | T13, T14 | evals.it.test (interrupted) |
| AC-48 | T9, T10 | eval-log-lines.test, eval-runner.test (no sentinel in logs) |
| AC-49 | T21 | RunEvalControl.test (one POST) |
| AC-50 | T18, T21, T22 | evals hooks test (2 s poll), RunEvalControl.test (progress, disabled), EvalsTab.test (refresh) |
| AC-51 | T19, T21 | helpers.test (deltaPt), MetricStrip.test (88%, ▲ 13pt, ▼) |
| AC-52 | T19, T21 | helpers.test (nullReason), MetricStrip.test (— + tooltip) |
| AC-53 | T21, T22 | MetricStrip.test (No eval runs yet), EvalsTab.test (never run) |
| AC-54 | T19, T21 | MetricStrip.test (v3 vs v4 notice) |
| AC-55 | T22 | EvalsTab.test (10 rows, link) |
| AC-56 | T21 | RunEvalControl.test (errors, 409 progress) |
| AC-57 | T21 | RunEvalControl.test (confirm text, Cancel) |
| AC-58 | T23, T28 | nav-evals.test, e2e 13 |
| AC-59 | T24 | EvalOverview.test (agents) |
| AC-60 | T24 | EvalOverview.test (6 recent, navigation) |
| AC-61 | T25 | AgentEvalPage.test (elements) |
| AC-62 | T18, T25 | evals hooks test (pages of 20), AgentEvalPage.test (25 runs) |
| AC-63 | T25 | AgentEvalPage.test (switcher, URL) |
| AC-64 | T24 | EvalOverview.test (states) |
| AC-65 | T25 | RunDetailDrawer.test |
| AC-66 | T25 | AgentEvalPage.test (selection 1/2/3) |
| AC-67 | T19, T26 | helpers.test (orderPair), CompareRunsDialog.test (title, order) |
| AC-68 | T26 | CompareRunsDialog.test (cells) |
| AC-69 | T19, T26 | helpers.test (diffWords, manifestDiff), CompareRunsDialog.test (marks, model line) |
| AC-70 | T19, T26 | helpers.test (caseChanges), CompareRunsDialog.test (groups) |
| AC-71 | T19, T26 | CompareRunsDialog.test (sets differ) |
| AC-72 | T26 | CompareRunsDialog.test (label, Escape, focus) + manual keyboard check |
| AC-73 | T15, T16 | eval-seed-fixture.test, seed-demo.it.test |
| AC-74 | T16 | seed-demo.it.test (second seed adds none) |
| AC-75 | T17, T31 | eval-experiment.test, verify:l06 |
| AC-76 | T31 | manual green/red run |
| AC-77 | T31 | manual offline, no-keys run |
| AC-78 | T15, T16 | eval-seed-fixture.test (runs parse, metrics consistent), seed-demo.it.test (fixture on/off) |
| AC-79 | T11, T12 | evals-routes.test (foreign ids -> 404) |
| AC-80 | T11, T12 | evals-routes.test (unknown 404, non-uuid 422) |
| AC-81 | T1, T12 | contracts.test, evals-routes.test (responses parse) |
| AC-82 | T1, T2, T32 | contracts.test (legacy parse), contracts-parity.test (block), contracts-evals.test |
| AC-83 | T20, T22 | EvalCaseDialog.test (img onerror), EvalsTab.test (hostile name) |
| AC-84 | T27 | e2e 12-agent-evals-tab |
| AC-85 | T28 | e2e 13-eval-dashboard-compare |
| AC-86 | T16, T29 | e2e 14-turn-into-eval-case, seed-demo.it.test (Stripe accepted after reset) |

No AC is unmapped.

## 6. Risks, assumptions, items needing user acknowledgement

- **A-1 (needs OK, before P1): parity of a marked block, not the whole file.** The `eval-ci.ts` copies already differ outside the eval section. The new block is self-contained (only `z`) and byte-identical, and the parity test compares the block. Making the whole file identical would import CI contracts into the client, which is out of scope.
- **A-2 (needs OK, before P4): AC-43 semantics.** A PR review start does not refuse a missing key (it returns 200, then the run fails). The eval start instead resolves the provider before writing and returns the same `ConfigError` (HTTP 500 `config_error`, message `"OPENROUTER_API_KEY is not configured"`). This is "the same error status and message" that the review path raises. A 400/424 would read better but would differ from the review path.
- **A-3 (needs OK, before P5): seeded version bump.** In fixture mode only, Security Reviewer is bumped to v2 (with a snapshot) using a one-sentence prompt suffix, so the two seeded runs are genuinely v1 and v2 and the latest run is not reported as drifted. The developer's real workspace is untouched. Alternative: keep the agent at v1 and label the seeded runs v1/v1. Compare would then read "v1 → v1", which weakens AC-85.
- **A-4 (needs OK, before P9): CI env line.** Flows 12-14 depend on `PROJECT_DOCS_SOURCE=fixture`, which `scripts/e2e.sh` sets but `.github/workflows/e2e-web.yml` does not (the pushing token lacked `workflow` scope). Without that line, flows 09-14 fail in CI. Editing CI needs the user's OK and a token with workflow scope.
- **R1. Flow 04 regression.** In fixture mode the Stripe finding is now accepted (muted, "Accepted" tag). Flow 04 asserts its title and "2 findings"; T16 must keep it green. Only one finding is decided (not the N+1 one) to minimise impact.
- **R2. Demo reset.** `resetDemoProject` runs on every dev boot. If the re-apply step in T16 is missed, AC-86 silently breaks locally while the hermetic e2e (seeded via `pnpm db:seed`, server not in development mode) may still pass. T16's integration test covers the reset path explicitly.
- **R3. Expression index.** drizzle-kit support for `(input_meta->>'source_finding_id')` unique indexes depends on the installed version. The fallback is the service check inside a transaction (T3 note).
- **R4. Root `package.json`.** It must stay script-only with no lockfile. Running `pnpm install` at the root would create one; document "do not install at root" in the README.
- **R5. Model nondeterminism and version semantics.** `setSkills` does not bump the agent version, so two runs at the same version can differ in skills. The manifest records skill ids and versions, and compare shows the difference.
- **R6. Background execution in a single process.** Runs are lost on restart and reaped as `interrupted` (AC-47). There is no queue; this matches review runs.
- **R7. Cost.** About 1 structured call per case, roughly $0.001 per case on the seeded model (server INSIGHTS). Only the manual demo spends money.
- **Assumptions:**
  - The draft uses the PR's current diff (`loadDiff`).
  - Saving re-validates the client-sent fragment (AC-14) instead of rebuilding it.
  - `cases_done` is derived from non-pending result rows.
  - Pending results of an interrupted run become `error` "interrupted".
  - `eval.json` is left untouched.
- **Housekeeping:** the untracked `e2e/specs/.10-trace-project-context.flow.json.swp` must not be committed.

## 7. Out of scope

Case Editor and case editing, trend charts, "Run all agents" and single-case runs, version replay, skill evals, the `evals/` harness, Export to CI, a new CI workflow for `verify:l06`, a PowerShell twin of the verify script (it can follow if Windows parity is requested), semantic matching, and repeated trials.

## 8. Validation

Commands:
- `server`:
  - `pnpm typecheck`
  - `pnpm exec vitest run --exclude '**/*.it.test.ts'`
  - `pnpm test` (integration, Docker)
  - `pnpm db:generate` produces exactly one new migration.
- `reviewer-core`: `pnpm typecheck && pnpm test`. reviewer-core is unchanged; its tests must stay green.
- `client`: `pnpm typecheck && pnpm test`. Do not run `pnpm build` next to a running dev server (client INSIGHTS).
- `scripts/e2e.sh`: flows 01-14 green.
- From the repo root: `pnpm verify:l06`, green offline with no keys.

Test strategy:
- Pure modules (scoring, fragment, draft, validate, finalize, log lines, client helpers) get table-driven unit tests.
- The runner is tested with a recording or prompt-aware fake `LLMProvider`.
- Routes use `buildApp` with `db: {} as Db` and repository prototype spies.
- DB behaviour (FK changes, cascades, the reaper, mid-run edits, table counts) uses `*.it.test.ts`.
- Client tests use RTL with mocked hooks and real `next-intl` messages.
- e2e uses seeded fixture data only and never starts a run.

Manual checks:
- Keyboard focus in the compare dialog and the run drawer (AC-72).
- The demo with a real model: two runs before and after a prompt edit, plus a screenshot of compare (homework deliverable, D-8).

Breaking changes: none.
- Contract changes are additive.
- The migration adds a table and nullable columns, and relaxes the `eval_runs.case_id` FK (the table is empty today).
- Review prompts and traces are untouched.

## 9. Execution mode (PENDING: the caller must ask the user)

**Recommendation: single-agent, sequential, with a report to the user after each wave:**
P1 → P2 → P3 → P4 → P5 → P10 → P6 → P7 → P8 → P9 → P11.

Rationale:
- About 32 tasks with heavy shared files: `eval-ci.ts` (both copies), `seed.ts`/`demo-reset.ts`, `messages/en/*.json`, `AgentEditor/constants.ts`.
- The previous feature used this mode successfully.
- P10 moves early so `pnpm verify:l06` guards every later phase.

Multi-agent alternative, for reference:

| Wave | Phases | Notes |
|---|---|---|
| 0 | P1 | Alone. Freezes the contracts. |
| 1 | P2, P3, P6 (T18-T19 against mocked hooks) | Parallel. P2 owns `schema/eval.ts` and `agents/helpers.ts`; P3 is new pure files only. |
| 2 | P4, P7 | P4 owns `modules/evals/**`, `modules/index.ts`, `app.ts`, `agents/service.ts`; P7 owns `AgentEditor/**`, `agents.json`, `evals.json`. |
| 3 | P5, P8, P10 | P5 owns `seed.ts`, `demo-reset.ts`, `server.ts`, `db/fixtures/eval-cases.ts`; P8 owns `nav.ts`, `app/evals/**`; P10 owns the root `package.json` and `scripts/verify-l06.sh`. |
| 4 | P9, P11 | e2e and docs need everything. |

Shared-file owners in multi-agent mode:
- `client/messages/en/prReview.json` → P6.
- `evals.json` → P7 (P8 appends after P7 finishes).
- `server/test/helpers/*` → P4.
- `seed-demo.it.test.ts` → P5.


## 10. Spec rev 3 addendum and user decisions (2026-10-11)

User decisions: A-1, A-2 and A-3 accepted as proposed; execution mode = single agent, sequential, report after each wave.

- **A-4 is a HARD STOP.** Do not edit anything under `.github/workflows/`. Document it instead (P11): e2e flows that need `PROJECT_DOCS_SOURCE=fixture` will fail in CI until the user adds that env line manually after the lab. The user will update workflows manually and must be reminded when the PR for this branch is created.
- **Priority cut (spec rev 3):** AC-45, AC-47, AC-57, AC-62, AC-63, AC-71, AC-72, AC-84, AC-85 are now P3. Implement them only after every P1/P2 task and `pnpm verify:l06` are green. Their tasks stay in the plan but are skipped by default.
- **New AC-88 (run isolation):** add to P4 a task "stateless per-case call: no tools, fresh message list, no access to other cases or runs" with test `server/test/eval-runner-isolation.test.ts` (recording fake provider, sentinel strings). Cost comparison across models = same case set run again after changing the agent's model (D-12).
- **New AC-87 (demo script):** add to P11 a task that writes the manual demo script (good prompt, changed prompt, deliberately broken prompt, compare) and the deliverables list (screenshot, screencast).
- Harness-plane note: if the `evals/` package is built later, its sessions must be isolated the same way (fixtures outside skill dirs, `evals/results/` unreadable by the evaluated session, read-only allow-list, isolated cwd), because models can read other runs' results.
