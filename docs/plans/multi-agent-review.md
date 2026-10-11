# Plan: Multi-Agent Review (SPEC-04)

Spec: `specs/04-multi-agent-review.md` (SPEC-04, rev 1, status `approved`, A-1..A-15 accepted). Branch: `feat/multi-agent-review` (worktree A).
Execution mode: **multi-agent (DECIDED by the caller)**, run with `run-plan`. There are 4 implementer phases (P1 to P4) and one final test-writer phase (P5). After that come architecture-reviewer, at most 2 fix subagents in total, then plan-verifier.
Author: `implementation-planner` (read-only); saved by the caller.

## 0. Spec gate

- Status is `approved`. No `[NEEDS CLARIFICATION]` is open: every unknown is resolved as an assumption, A-1..A-15.
- The ACs are atomic. All 47 are mapped in section 5.
- Order: contracts -> server -> client -> i18n -> docs. i18n and docs are the last tasks of each phase that owns them.
- Implementers do NOT write tests. Each task still names its test(s); P5 (test-writer) writes all of them.

## 1. Research findings (verified in the worktree)

### 1a. Launch path
- `server/src/modules/reviews/routes.ts:27-44`: `POST /pulls/:id/review` parses `RunRequest.parse(req.body ?? {})`.
  - A `ZodError` becomes the app-wide 422 `validation_error` (`app.ts:145-157`). That matches AC-14's 422.
  - It then calls `service.resolveTargets` and `service.runReview`, and returns `{pr_id, runs, reviews}`.
- `ReviewService.resolveTargets` (`service.ts:46-57`) handles `all` and `agentId`. Otherwise it throws `AppError('invalid_run_request', ..., 400)`. This is the place for the AC-14 400 (A-15).
- `ReviewService.runReview` (`service.ts:103-138`):
  - looks up the pull and repo first (404 before any write);
  - creates the `agent_runs` rows with `repo.createAgentRun`;
  - fires `executor.executeRuns` without awaiting it, then returns.
  - So AC-16's "answer immediately" already holds.
- `run.repo.ts:126` `createAgentRun` inserts `status 'running'`, `source 'local'`.

### 1b. Executor
- `run-executor.ts:174-282` `executeRuns` loads the diff once (`loadDiff`, line 219) and derives the intent once (`deriveIntent`, line 232). AC-18 already holds.
- A diff failure runs `failAll` (lines 197-215), which marks every job `failed` with the same message. AC-21 is existing behaviour.
- Agents run **sequentially** (`for ... await this.runOneAgent`, line 243). AC-19 is missing.
- `runOneAgent` catches failures and cancels itself: it persists the status, error and trace, then rethrows. The loop's catch only logs. So turning the loop into `Promise.allSettled` keeps the per-agent isolation (AC-20).
- `RunLogger.forRun` (`platform/run-logger.ts:45`) returns a new logger, with no shared mutable state, so concurrent use is safe.

### 1c. DB
- `server/src/db/schema/runs.ts`:
  - `multi_agent_runs` exists (`id`, `workspace_id`, `pr_id`, `ran_at`) and nothing uses it.
  - `agent_runs` has no link to it.
  - `agent_runs.agent_id` is `set null` on agent delete (the "Deleted agent" edge case).
- Migrations end at `0015_adorable_marvex.sql`. `pnpm db:generate` will produce `0016_*`.

### 1d. Contracts (both vendored copies currently identical by line count and content)
- `contracts/observability.ts` has stubs for `AgentColumnFinding`, `AgentColumn` (status `done|failed|running`, `agent_id` non-null, no `error`), `ConflictTake`, `Conflict` and `MultiAgentRun` (no `groups`).
- `contracts/platform.ts:375` `RunRequest = {agentId?, all?}`.
- `contracts/review-api.ts:52` `ReviewRunResponse = {pr_id, runs, reviews}`.
- `server/test/contracts-parity.test.ts` checks `brief.ts`, `trace.ts` and `platform.ts`, but not `observability.ts` or `review-api.ts`.

### 1e. Read side
- `reviews` rows carry `agent_id` and `run_id` (`review.repo.ts:61`). Findings carry `scope` (`in|out|signal|null`).
- `reviews/scope-visibility.ts` `isVisibleScope` is the single server rule for "shown".
- `AgentsRepository.list(workspaceId)` returns every agent of the workspace (needed for estimates).

### 1f. Client
- `components/app-shell/helpers.ts:28` already maps any path containing `/multi-agent` to the active key `"multi-agent"`. The nav item key must therefore be `"multi-agent"`.
- `vendor/ui/nav.ts` has WORKSPACE with only `pulls`. The `Users` icon exists in `vendor/ui/icons.tsx`.
- `RunReviewDropdown` (`pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`) only receives `prId`; it has no repo id or PR number.
  - `PrDetailHeader` renders it and has `pr.number`, but not `repoId`.
  - `page.tsx` has `repoId` from `useParams`.
- `RunTraceDrawer` (default export, props `runId`, `agentName`, `prNumber`, `findings`, `running`, `onClose`) already streams the live log while `running` and shows the trace otherwise. It is reused unchanged (AC-38).
- `FindingCard` (named export, props `f`, `onAction`, `pending`, `repoFullName`, `headSha`) already shows confidence, suggested fix, Accept, Dismiss and Turn into eval case. It is reused unchanged (AC-39).
- `useFindingAction` invalidates `["reviews", prId]`, the same query the PR page reads (AC-40).
- `usePrRuns` already polls every 4 s while a run is running; the same pattern is used for AC-35.
- `lib/providers.tsx:41-47`: the global `MutationCache.onError` toasts **every** mutation error, and only `meta.silent429` opts out. See D-4.
- The client may import only **types** from `@devdigest/shared` (`client/INSIGHTS.md`), so the 5-agent limit must be mirrored as a local constant.
- next-intl auto-loads every `client/messages/en/*.json`, so `multiAgent.json` needs no registration.

## 2. Spec vs code notes and plan decisions

Mismatches (none blocks the plan):
1. The `observability.ts` header says `MultiAgentRun` is the response of `POST /pulls/:id/multi-agent-run`. A-1 supersedes this; P1 updates the comment to `GET /multi-agent-runs/:id`.
2. AC-21's "existing behaviour" is confirmed (`failAll`).
3. AC-18 is already true. The work is only AC-19 parallelism, plus keeping the AC-18 guarantee under concurrency.
4. The global mutation toast would double the AC-12 toast. See D-4.

Plan decisions (implementation level; the architecture-reviewer should check them):
- **D-1 (flag to the user): visible scope only.** Columns, groups and takes use findings with `isVisibleScope(scope)` (they exclude `out`, as the PR page hides them by default), so suppressed findings never create disagreements.
  - Tabs mode still renders the full review from `GET /pulls/:id/reviews` (AC-39), where `FindingCard` already marks `out` findings.
- **D-2: ConflictTake for deleted agents.** `ConflictTake.agent_id` becomes `z.string().nullable()` and gains `run_id: z.string()`. Both are additive and widening, and mirror the AC-47 `AgentColumn.agent_id` change. `persona` = column `agent_name`.
- **D-3: estimate contract.** New `AgentRunEstimate = {agent_id, sample_size, avg_duration_ms: int|null, avg_cost_usd: number|null}` in `observability.ts` (additive). `GET /multi-agent/estimates` returns `AgentRunEstimate[]`.
- **D-4: one launch-error toast.** `lib/providers.tsx` `MutationCache.onError` also returns early when `mutation.meta?.silent === true`.
  - `useLaunchMultiAgent` sets `meta: { silent: true }`.
  - `ConfigureRun` calls `notify.error(err instanceof ApiError ? err.message : String(err))` itself.
  - The result is exactly one toast, and AC-12 can be tested with a mocked hook.
- **D-5: deleted agent name.** The server fills `agent_name = 'Deleted agent'` when the agent row is gone (columns are ordered by it). The client renders `t("results.deletedAgent")` when `agent_id === null`.
- **D-6: group id.** `grp_<lexicographically smallest member finding id>`, stable for the same input (AC-28).
- **D-7: status mapping.** The DB `agent_runs.status` maps to `running|done|failed|cancelled`; any other or null value maps to `failed`. A column is finished when `done` and terminal when not `running`.
- **D-8: PR order.** "Newest first" means PR `number` descending.
- **D-9: parallelism (A-2).** `Promise.allSettled` over all jobs, with no cap. "Run all enabled agents" becomes parallel too.
- **D-10: client URL helpers.** `configureRunHref(repoId, {pr?, agents?})` and `resultsHref(repoId, id, view?)` live in `multi-agent/_components/ConfigureRun/helpers.ts`. They are used by the dropdown (P3) and the results page (P4).

## 3. Implementation strategy

### 3a. Contracts (P1; both copies byte-identical)

`contracts/observability.ts`:
- `FindingAttribution = z.object({ agent_id: z.string().nullable(), agent_name: z.string(), run_id: z.string() })`
- `AgentColumnFinding` gains `end_line: z.number().int()` and the `FindingAttribution` fields. Export the alias `AttributedFinding = AgentColumnFinding` (schema and type).
- `AgentColumn`:
  - `agent_id` becomes `z.string().nullable()`;
  - `status` becomes `z.enum(['running','done','failed','cancelled'])`;
  - add `error: z.string().nullable()`;
  - `findings: z.array(AttributedFinding)`.
- `ConflictTake`: `agent_id` becomes nullable; add `run_id: z.string()` (D-2).
- `FindingGroup = { id, file, start_line, end_line, title, members: AttributedFinding[], takes: ConflictTake[], is_conflict: boolean }`
- `MultiAgentRun.groups: z.array(FindingGroup)`. Update the header comment.
- `AgentRunEstimate` (D-3).

`contracts/platform.ts`:
- `RunRequest.agentIds: z.array(z.string().min(1)).min(1).max(5).refine(ids => new Set(ids).size === ids.length, { message: 'agentIds must be distinct' }).optional()`

`contracts/review-api.ts`:
- `ReviewRunResponse.multi_agent_run_id: z.string().optional()`

### 3b. Server

Reviews module (launch and executor):
- `resolveTargets(ws, {agentId?, all?, agentIds?})`:
  1. `agentIds` combined with `agentId` or `all` gives 400 `invalid_run_request`.
  2. Otherwise each id goes through `agents.getById(ws, id)` in order. Any miss gives `NotFoundError('Agent not found')` before any write (AC-15).
- `runReview(ws, prId, targets, logger, { multiAgent })`:
  1. pull and repo lookups (unchanged);
  2. if `multiAgent`: `repo.createMultiAgentRun({workspaceId, prId})`, then each `createAgentRun({..., multiAgentRunId})`;
  3. log `logger.info({ multi_agent_run_id, pr_id, agents: n }, 'review: multi-agent launch')`;
  4. return `{ runs, reviews: [], multiAgentRunId? }`.
- The route adds `multi_agent_run_id` only when it is set (AC-17).
- `executeRuns`: unchanged pre-work. The per-job body moves into `jobs.map(async job => {...})` and is awaited with `Promise.allSettled`.

New module `server/src/modules/multi-agent/`:

| File | Kind | Role |
|---|---|---|
| `constants.ts` | pure | `LINE_GAP = 3`, `JACCARD_MIN = 0.5`, `MIN_WORD_LEN = 3`, `ESTIMATE_SAMPLE = 10`, `DELETED_AGENT_NAME = 'Deleted agent'`, `SEVERITY_RANK` |
| `grouping.ts` | pure | `titleWords`, `jaccard`, `linked(a,b)` (same file AND gap <= 3 AND (same category OR Jaccard >= 0.5)), `groupFindings(findings)` (sort input by file/start/end/agent/id, union-find, groups sorted by file/start_line/id, members by agent_name/start_line/id; group title = most severe member, then agent name, then id), `applyTakes(groups, finishedColumns)` (AC-29..31), `conflictsOf(groups)` |
| `read-model.ts` | pure | `mapStatus` (D-7), `toColumn(run, agentName, review, findings)` (visible-scope findings -> attributed), `totals(parentRanAt, columns+ranAt)` (AC-24), `buildMultiAgentRun(parent, pull, children, reviews)` (columns ordered by agent_name then run_id; groups from `done` columns only; conflicts) |
| `estimates.ts` | pure | `estimateFromRuns(agentId, rows)`: sample = rows.length; avg duration = rounded mean of non-null `duration_ms`, null if 0 rows; avg cost = mean of non-null costs, or null |
| `repository.ts` | DB (read-only) | `getParent(ws, id)`, `childRuns(ws, id)` (left join agents for name), `reviewsForRuns(runIds)` (+ findings), `pullNumber(prId)`, `lastDoneRuns(ws, agentId, 10)`. **No writes** (AC-26). |
| `service.ts` | IO | `getRun(ws, id)` (404 `NotFoundError('Multi-agent run not found')`), `estimates(ws)` (`agentsRepo.list(ws)` then per agent `lastDoneRuns`) |
| `routes.ts` | HTTP | `GET /multi-agent-runs/:id` (`IdParams`), `GET /multi-agent/estimates`; both use `getContext` for the workspace |

Registered in `server/src/modules/index.ts` (one import, one entry `multiAgent`).

### 3c. Client

Hooks (`client/src/lib/hooks/multi-agent.ts`, re-exported from `hooks/index.ts`):
- `useMultiAgentEstimates()`: `GET /multi-agent/estimates`.
- `useLaunchMultiAgent()`: `POST /pulls/:prId/review {agentIds}`, `meta: { silent: true }`. On success it invalidates `["reviews", prId]`, `["pr-runs", prId]` and `["pr-active-runs", prId]`.
- `useMultiAgentRun(id)`:
  - key `["multi-agent-run", id]`;
  - `refetchInterval: q => q.state.data?.columns.some(c => c.status === "running") ? 4000 : false`;
  - `retry` skips 404 (the `useIntent` pattern).

Configure run (`/repos/[repoId]/multi-agent?pr=<n>&agents=<id,id>`):
- `page.tsx` (AppShell + `RepoNotFound` pattern) renders `ConfigureRun`.
- PR `<select>` (labelled): "#n · title", newest first. Changing it does `router.replace` with `?pr=`.
- With no PR selected: the empty state and a disabled button.
- With a PR selected: agent checkbox cards (real `<input type=checkbox>` with label) showing name, model and the estimate label.
  - Default selection: the `agents` param ids (if present, AC-33), else enabled agents, first 5 (AC-5).
  - Select all / Clear all, the 5-limit hint, and disabled unchecked boxes at 5.
  - Estimate line; run button label by count.
  - Merged warning (`prReview` `runReview.mergedWarning`) next to the button for merged or closed PRs.
- On launch: one `mutate` guarded by `isPending`, button `loading`. On success, `router.push(resultsHref(...))`. On error, a toast, and the state is kept.

Results (`/repos/[repoId]/multi-agent/[id]?view=columns|tabs`):
- Header: "Configure run" button (`configureRunHref` with `pr_number` and column agent ids), title, "N agents · parallel", Columns/Tabs switch (`aria-pressed`), meta row "#n title · total time · total cost".
- Body: Columns view (`AgentColumnCard` per column) or Tabs view (`AgentTabsView`), then `DisagreementsBlock`.
- One `RunTraceDrawer` mounted from local state `{runId, running, agentName}`.
- States: skeleton while loading; 404 shows "Multi-agent run not found" with a link to Configure run; other errors show `ErrorState` with Retry.
- `AgentTabsView` reads `usePrReviews(run.pr_id)` and picks the review with `run_id === column.run_id`. It renders `FindingCard` per finding with `useFindingAction({ prId })`, and passes `repoFullName` (`useActiveRepo`) and `headSha` (from `usePulls` PrMeta).

## 4. Phases and tasks

Paths are relative to the worktree root. "Test:" names the test P5 writes.

### P1: Contracts + DB schema (implementer; wave 0, alone)
Owns: `server/src/vendor/shared/contracts/{observability,platform,review-api}.ts`, `client/src/vendor/shared/contracts/{observability,platform,review-api}.ts`, `server/src/db/schema/runs.ts`, the generated `server/src/db/migrations/0016_*.sql` + `meta/**`.

- [x] **T1** Extend `observability.ts` as in 3a (FindingAttribution, AttributedFinding, AgentColumn, ConflictTake (D-2), FindingGroup, MultiAgentRun.groups, AgentRunEstimate, header comment). Copy byte-identically to the client. -> AC-47, AC-25, AC-28, AC-30, AC-10 -> `server/test/contracts-multi-agent.test.ts > parses a sample MultiAgentRun with columns, groups and conflicts`; `server/test/contracts-parity.test.ts > observability.ts byte-identical`
- [x] **T2** Add `RunRequest.agentIds` (`platform.ts`) and `ReviewRunResponse.multi_agent_run_id` (`review-api.ts`) in both copies. -> AC-47, AC-14 -> `contracts-multi-agent.test.ts > old-shape RunRequest ({agentId}, {all:true}, {}) still parses`, `> agentIds [] / 6 ids / duplicates rejected`; `contracts-parity.test.ts > review-api.ts byte-identical` (platform.ts already covered)
- [x] **T3** Add `multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, { onDelete: 'set null' })` to `agentRuns` in `schema/runs.ts`. Run `pnpm db:generate` in `server/`; never hand-edit the output. -> AC-16, AC-17 -> covered by T6 tests (`reviews-multi-agent-launch.test.ts`)
- Gate: `server: pnpm typecheck`, `client: pnpm typecheck`.

### P2: Server (implementer; wave 1, after P1; parallel with P3)
Owns: `server/src/modules/reviews/{routes,service,run-executor,repository}.ts`, `server/src/modules/reviews/repository/run.repo.ts`, `server/src/modules/multi-agent/**` (new), `server/src/modules/index.ts`, `server/README.md`.

- [x] **T4** `run.repo.ts`:
  - `createMultiAgentRun(db, {workspaceId, prId}): Promise<string>`;
  - `createAgentRun` accepts optional `multiAgentRunId`;
  - wrappers in `ReviewRepository`.
  -> AC-16, AC-17 -> `server/test/reviews-multi-agent-launch.test.ts > valid agentIds: one parent row, three linked running children`
- [x] **T5** `resolveTargets` handles `agentIds` (400 on combination, 404 on any foreign or unknown id before writes, order kept). The route forwards `agentIds` and returns `multi_agent_run_id` only when set; update the route doc comment. -> AC-14, AC-15, AC-17 -> `reviews-multi-agent-launch.test.ts > 422 validation_error for [], 6 ids, duplicates; no rows`, `> 400 invalid_run_request for agentIds+agentId and agentIds+all; no rows`, `> 404 for one foreign id; zero parent and child rows`, `> {agentId} and {all:true}: no parent row, null link, no multi_agent_run_id in response`
- [x] **T6** `runReview(..., { multiAgent })`: create the parent then the linked children, log the launch line, return `multiAgentRunId`. -> AC-16, AC-17 -> `reviews-multi-agent-launch.test.ts > answers with {pr_id, runs(3), reviews: [], multi_agent_run_id} while the LLM never resolves`
- [x] **T7** `executeRuns`:
  - replace the sequential loop with `Promise.allSettled(jobs.map(...))`;
  - keep the diff and intent once;
  - keep `failAll`;
  - refresh the doc comments.
  -> AC-18, AC-19, AC-20, AC-21 -> `server/src/modules/reviews/run-executor.parallel.test.ts` (pattern of `run-executor.scope.test.ts`): `> 3 agents: loadDiff once, intent derivation at most once`; `> deferred LLM: all 3 reviewPullRequest calls started before any resolves`; `> agent 2 of 3 throws: agents 1 and 3 done with persisted reviews, agent 2 failed with its error`; `> diff loader fails: every child failed with the same error`
- [x] **T8** Pure layer `multi-agent/{constants,grouping,read-model,estimates}.ts` as in 3b. -> AC-10, AC-21, AC-23, AC-24, AC-25, AC-27, AC-28, AC-29, AC-30, AC-31 ->
  - `server/test/multi-agent-grouping.test.ts`:
    - `> same file + overlapping lines + equal category -> one group`
    - `> same lines, different file -> separate`
    - `> 4 lines apart -> separate; 3 apart -> grouped`
    - `> different category, title Jaccard >= 0.5 -> grouped`
    - `> transitive A-B-C -> one group`
    - `> shuffled input -> identical output`
    - `> group fields: id stable, file, start/end span, title of most severe (tie by agent name), members unchanged`
    - `> 3 done columns, group flagged by 2 -> 3 takes, one ignored with empty note`
    - `> one failed column -> 2 takes`
    - `> all WARNING -> not conflict; WARNING vs SUGGESTION -> conflict; one ignored -> conflict; conflicts == conflict subset`
    - `> one done + one running -> no takes, is_conflict false, conflicts []`
    - `> same agent twice on same lines -> both members, take uses most severe`
  - `server/test/multi-agent-read-model.test.ts`:
    - `> done/failed/running columns carry every field and are ordered by agent name then run id`
    - `> totals: cost sums known terminal costs (null column ignored, null when none); duration = latest terminal completion - parent ran_at; 0 when none terminal`
    - `> every finding carries agent_id/agent_name/run_id of its review`
    - `> all children failed -> all columns failed, groups/conflicts empty`
    - `> deleted agent -> agent_id null, agent_name "Deleted agent"`
    - `> out-of-scope findings excluded (D-1)`
  - `server/test/multi-agent-estimates.test.ts > 12 done + 2 failed + one null-cost: sample 10, averages over the latest 10 done, failed ignored, cost mean of non-null`; `> no runs: sample 0, both null`
- [x] **T9** `multi-agent/{repository,service,routes}.ts`; register `multiAgent` in `modules/index.ts`. The repository has only `select` queries. -> AC-10, AC-22, AC-25, AC-26 -> `server/test/multi-agent-routes.test.ts` (in-memory repository spies, pattern of `evals-routes.test.ts`):
  - `> GET /multi-agent-runs/:id own workspace parses with MultiAgentRun`
  - `> foreign-workspace and unknown id -> 404`
  - `> GET /multi-agent/estimates returns only the caller's workspace agents`
  - `> GET /pulls/:id/reviews identical before and after GET /multi-agent-runs/:id; no insert/update/delete called`
  - `> returned findings' attribution equals their reviews rows`
- [x] **T10** Docs in `server/README.md`: the `agentIds` body and `multi_agent_run_id` response of `POST /pulls/:id/review`, `GET /multi-agent-runs/:id`, `GET /multi-agent/estimates`, the multi-agent module paragraph (read-only grouping, thresholds, parallel agents). -> AC-47 (documentation) -> review only
- Gate: `server: pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` (existing tests stay green, AC-17).

### P3: Client launch and Configure run (implementer; wave 1, after P1; parallel with P2)
Owns:
- `client/src/lib/hooks/multi-agent.ts` (new), `client/src/lib/hooks/index.ts`, `client/src/lib/providers.tsx`
- `client/src/app/repos/[repoId]/multi-agent/page.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/ConfigureRun/**`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx`, `.../PrDetailHeader/PrDetailHeader.tsx`, `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `client/src/vendor/ui/nav.ts`
- `client/messages/en/multiAgent.json` (creates it, `configure.*` keys), `client/messages/en/prReview.json`

P3 builds against the P1 contracts with mocked network; it does not need P2 to compile.

- [ ] **T11** Hooks file (3c) and the D-4 opt-out in `providers.tsx`; export from `hooks/index.ts`. -> AC-11, AC-12, AC-35, AC-42 -> `client/src/lib/hooks/multi-agent.test.tsx > refetches every 4 s while a column is running (fake timers)`, `> stops refetching when all columns are terminal`, `> 404 is not retried`
- [ ] **T12** `ConfigureRun/constants.ts` and `helpers.ts`:
  - `MAX_AGENTS = 5`;
  - `sortPullsNewestFirst`;
  - `defaultSelection(agents, presetIds)`;
  - `agentEstimateLabel(est)` ("≈ 9.1s · $0.18" or null for "No run history"; the cost part is omitted when the average cost is null);
  - `selectionEstimate(selectedIds, estimates)` returning `{seconds, cost, withoutHistory}` (T = max avg duration, C = sum of non-null avg costs, among agents with `sample_size > 0`);
  - `formatSeconds` (1 decimal);
  - `formatUsd` (2 decimals, 4 below $0.01);
  - `runButtonState(n)` (`select|one|many`);
  - `configureRunHref`, `resultsHref` (D-10).
  -> AC-3, AC-5, AC-8, AC-9, AC-33 -> `ConfigureRun/helpers.test.ts > selectionEstimate: three agents, one without history -> T, C, suffix count 1`, `> agentEstimateLabel both forms`, `> sortPullsNewestFirst`, `> defaultSelection: preset ids win, else first 5 enabled`, `> configureRunHref encodes pr and agents`
- [ ] **T13** `ConfigureRun.tsx` (+ local `AgentPickCard.tsx`, `styles.ts`, `index.ts`) and `multi-agent/page.tsx` as in 3c. -> AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11, AC-12, AC-13, AC-33 -> `ConfigureRun/ConfigureRun.test.tsx`:
  - `> two-PR fixture lists "#n · title" newest first`
  - `> no ?pr: "Pick a pull request first", run button disabled`
  - `> 6 enabled + 1 disabled: 7 cards, first 5 enabled checked, others unchecked, estimate and "No run history" forms`
  - `> Select all picks first 5; Clear all at 5 clears`
  - `> 5 checked: unchecked boxes disabled + "Up to 5 agents per run"`
  - `> labels for 0 / 1 / 3 selected and enabled state`
  - `> estimate line "≈ …s · $… · parallel · 1 without history"`
  - `> run: one mutate call with ids in card order, loading, no second call on double click, push to results URL`
  - `> rejecting mutation: toast with server message, PR and selection kept`
  - `> merged PR: warning shown, button enabled`
  - `> ?agents=a,b preselects exactly those agents`
- [ ] **T14** `RunReviewDropdown` gains optional `repoId` and `prNumber` props. When both are set, it renders the item `t("runReview.multiAgent")` (icon `Users`) after "Run all enabled agents" and before the per-agent list, and it pushes `configureRunHref(repoId, { pr: prNumber })`. `PrDetailHeader` gains a `repoId` prop and passes `repoId` and `pr.number`; `page.tsx` passes `repoId`. -> AC-1 -> `RunReviewDropdown.test.tsx > "Multi-agent review…" sits between Run all and the agent list and navigates to /repos/<repoId>/multi-agent?pr=<number>`
- [ ] **T15** `nav.ts`: WORKSPACE gains `{ key: "multi-agent", label: "Multi-Agent Review", icon: "Users", href: "/repos/:repoId/multi-agent" }` after `pulls` (no gKey). -> AC-2 -> `client/src/test/nav-multi-agent.test.tsx > WORKSPACE has "Multi-Agent Review" after Pull Requests; resolveHref -> /repos/r1/multi-agent; activeKeyFor matches the key`
- [ ] **T16** i18n, in two files:
  - `multiAgent.json` `configure.*`: `title` "Configure run", `prLabel` "Pull request", `prPlaceholder` "Select a pull request", `prOption` "#{number} · {title}", `pickPrFirst` "Pick a pull request first", `agentsLabel` "Agents", `selectAll` "Select all", `clearAll` "Clear all", `limitHint` "Up to 5 agents per run", `noHistory` "No run history", `disabled` "disabled", `estimate` "≈ {seconds}s · ${cost} · parallel", `withoutHistory` " · {count} without history", `runSelect` "Select agents", `runOne` "Run 1 agent", `runMany` "Run multi-agent review ({count})".
  - `prReview.json` `runReview.multiAgent`: "Multi-agent review…".
  -> AC-1, AC-4, AC-7, AC-8, AC-9 -> asserted by T13/T14 tests (they load the real message files)
- Gate: `client: pnpm typecheck && pnpm test`.

### P4: Client results page (implementer; wave 2, after P3)
Owns: `client/src/app/repos/[repoId]/multi-agent/[id]/page.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/{MultiAgentResults,AgentColumnCard,AgentTabsView,DisagreementsBlock}/**`, `client/messages/en/multiAgent.json` (handed over from P3; adds the `results.*` and `disagreements.*` keys only), `client/README.md`.
P4 reads but does not edit P3 files: the hooks, `ConfigureRun/helpers.ts`, `RunTraceDrawer`, `FindingCard`.

- [ ] **T17** `MultiAgentResults/helpers.ts` + `constants.ts`:
  - `isTerminal`, `finishedCount`;
  - `statusKey(status)`;
  - `alsoFlaggedBy(groups)`: `Map<findingId, otherAgentNames[]>`;
  - `groupsToShow(groups, onlyConflicts)`: groups with takes, or only `is_conflict`;
  - `VIEWS = ["columns","tabs"]`, default `columns`.
  -> AC-34, AC-37, AC-41, AC-44, AC-46 -> `MultiAgentResults/helpers.test.ts > alsoFlaggedBy lists only other agents`, `> groupsToShow off = all with takes, on = conflicts only`, `> invalid ?view falls back to columns`
- [ ] **T18** `MultiAgentResults.tsx` (header, `?view` switch with `router.replace`, skeleton / 404 / error + Retry, empty "No agent runs left in this review.", drawer host) and `[id]/page.tsx` (AppShell + RepoNotFound). -> AC-32, AC-33, AC-35, AC-41, AC-42 -> `MultiAgentResults/MultiAgentResults.test.tsx`:
  - `> header: Configure run, title, "3 agents · parallel", Columns/Tabs switch, "#482 title", total time and cost`
  - `> Configure run href carries pr and all column agent ids`
  - `> ?view=tabs renders Tabs mode`
  - `> loading -> skeleton; 404 -> "Multi-agent run not found" + link; 500 -> error with Retry`
- [ ] **T19** `AgentColumnCard`:
  - name, text status label;
  - duration and cost (or "—" until terminal), score when done;
  - error text for failed or cancelled;
  - compact items (severity, title, `file:line`, truncated with `title` tooltip, "Also flagged by …");
  - "No findings";
  - footer "View trace" + "<n> findings".
  -> AC-34, AC-36, AC-37, AC-38 -> `AgentColumnCard/AgentColumnCard.test.tsx > one column per status: labels, dash until terminal, score when done, footer`, `> failed column shows its error; done columns still show findings`, `> "Also flagged by Security" on both items of a two-agent group`, `> View trace calls onOpenTrace(runId, running = status === "running")`
- [ ] **T20** `AgentTabsView`:
  - one tab per column: name + score, or status while not done;
  - detail: summary, score, View trace, duration, cost;
  - `FindingCard` list from `usePrReviews(pr_id)` matched by `run_id`, with `useFindingAction({ findingId, action, prId })`.
  -> AC-38, AC-39, AC-40 -> `AgentTabsView/AgentTabsView.test.tsx > tabs and header; FindingCard with confidence, suggested fix, Accept, Dismiss, Turn into eval case`, `> Accept calls the finding action with prId and the card shows Accepted`, `> View trace opens the drawer for the selected run`
- [ ] **T21** `DisagreementsBlock`:
  - title "Where agents disagree";
  - labelled `role="switch"` "Show only conflicts" (off by default);
  - rows `file:line` + group title + one cell per take (agent name, severity upper-case or muted "did not flag", note);
  - AC-45 and AC-46 messages.
  -> AC-43, AC-44, AC-45, AC-46 -> `DisagreementsBlock/DisagreementsBlock.test.tsx > one cell per finished agent with "did not flag" and original titles`, `> switch toggles all-with-takes vs conflicts only`, `> all agree + switch on -> "No disagreements: all finished agents agree."`, `> one done + two running -> "Disagreements appear when at least two agents have finished."`
- [ ] **T22** i18n, in `multiAgent.json`:
  - `results.*`: `title` "Multi-Agent Review", `agentsParallel` "{count} agents · parallel", `configureRun` "Configure run", `viewColumns` "Columns", `viewTabs` "Tabs", `status.running|done|failed|cancelled` "Running|Done|Failed|Cancelled", `viewTrace` "View trace", `findingsCount` "{count, plural, one {# finding} other {# findings}}", `noFindings` "No findings", `alsoFlaggedBy` "Also flagged by {names}", `deletedAgent` "Deleted agent", `notFound` "Multi-agent run not found", `loadError` "Couldn't load this multi-agent run", `retry` "Retry", `noColumns` "No agent runs left in this review.", `score` "Score {score}", `summary` "Summary".
  - `disagreements.*`: `title` "Where agents disagree", `onlyConflicts` "Show only conflicts", `didNotFlag` "did not flag", `noConflicts` "No disagreements: all finished agents agree.", `needTwo` "Disagreements appear when at least two agents have finished.".
  - Plus the `client/README.md` route rows for `/repos/[repoId]/multi-agent` and `/repos/[repoId]/multi-agent/[id]`.
  -> AC-32, AC-34, AC-42, AC-43, AC-45, AC-46 -> asserted by T18-T21 tests (real message file loaded)
- Gate: `client: pnpm typecheck && pnpm test`.

### P5: Tests (test-writer; wave 3, after P2 and P4; single phase)
Owns only new or extended test files:
- server: `test/contracts-multi-agent.test.ts`, `test/contracts-parity.test.ts` (add `observability.ts`, `review-api.ts` to the list), `test/reviews-multi-agent-launch.test.ts`, `src/modules/reviews/run-executor.parallel.test.ts`, `test/multi-agent-{grouping,read-model,estimates,routes}.test.ts`;
- client: `src/lib/hooks/multi-agent.test.tsx`, `ConfigureRun/{helpers,ConfigureRun}.test.ts(x)`, `RunReviewDropdown.test.tsx` (extend), `src/test/nav-multi-agent.test.tsx`, `MultiAgentResults/{helpers,MultiAgentResults}.test.ts(x)`, `AgentColumnCard`, `AgentTabsView`, `DisagreementsBlock` tests.

Rules:
- Every test is named exactly as in T1-T21.
- Unit tests only: no DB, so `.it.test.ts` is not used. DB rows are asserted through in-memory repository spies (pattern of `evals-routes.test.ts` / `test/helpers/fake-eval-store.ts`).
- Client tests use `fireEvent` (no user-event installed) and load `multiAgent.json` / `prReview.json` explicitly.
- If a test exposes a product bug, report it and do not change product code; it goes to the fix loop.
- Gate: all four verification commands (section 7) green.

## 5. Coverage table (AC -> tasks -> tests)

| AC | Tasks | Tests |
|---|---|---|
| AC-1 | T14, T16 | RunReviewDropdown.test (item + target) |
| AC-2 | T15 | nav-multi-agent.test |
| AC-3 | T12, T13 | helpers.test (sort), ConfigureRun.test (two PRs) |
| AC-4 | T13, T16 | ConfigureRun.test (no ?pr) |
| AC-5 | T12, T13 | helpers.test (defaultSelection, label), ConfigureRun.test (7 cards) |
| AC-6 | T13 | ConfigureRun.test (Select all / Clear all) |
| AC-7 | T13, T16 | ConfigureRun.test (5 checked) |
| AC-8 | T12, T13, T16 | ConfigureRun.test (0/1/3 labels) |
| AC-9 | T12, T13, T16 | helpers.test (selectionEstimate), ConfigureRun.test (estimate line) |
| AC-10 | T1, T8, T9 | multi-agent-estimates.test, multi-agent-routes.test (scoping) |
| AC-11 | T11, T13 | ConfigureRun.test (one call, loading, navigation) |
| AC-12 | T11, T13 | ConfigureRun.test (toast, selection kept) |
| AC-13 | T13 | ConfigureRun.test (merged warning) |
| AC-14 | T2, T5 | contracts-multi-agent.test, reviews-multi-agent-launch.test (422/400, no rows) |
| AC-15 | T5 | reviews-multi-agent-launch.test (404, zero rows) |
| AC-16 | T3, T4, T6 | reviews-multi-agent-launch.test (parent + 3 linked running children, immediate answer) |
| AC-17 | T3, T5, T6 | reviews-multi-agent-launch.test (old bodies: no parent, null link); existing tests unchanged |
| AC-18 | T7 | run-executor.parallel.test (one diff, at most one intent) |
| AC-19 | T7 | run-executor.parallel.test (all started before resolve) |
| AC-20 | T7 | run-executor.parallel.test (agent 2 fails) |
| AC-21 | T7, T8 | run-executor.parallel.test (diff fails), multi-agent-read-model.test (all failed) |
| AC-22 | T9 | multi-agent-routes.test (parse, 404) |
| AC-23 | T8 | multi-agent-read-model.test (fields, order) |
| AC-24 | T8 | multi-agent-read-model.test (totals) |
| AC-25 | T1, T8, T9 | multi-agent-read-model.test, multi-agent-routes.test (attribution) |
| AC-26 | T9 | multi-agent-routes.test (snapshot equal, no writes) |
| AC-27 | T8 | multi-agent-grouping.test (link rules, transitive, shuffle) |
| AC-28 | T1, T8 | multi-agent-grouping.test (group fields) |
| AC-29 | T8 | multi-agent-grouping.test (takes) |
| AC-30 | T1, T8 | multi-agent-grouping.test (is_conflict, conflicts subset) |
| AC-31 | T8 | multi-agent-grouping.test (one done + one running) |
| AC-32 | T18, T22 | MultiAgentResults.test (header) |
| AC-33 | T12, T13, T18 | helpers.test (href), ConfigureRun.test (?agents preselect), MultiAgentResults.test (href) |
| AC-34 | T17, T19, T22 | AgentColumnCard.test (status labels, dash, footer) |
| AC-35 | T11, T18 | multi-agent.test hook (fake timers) |
| AC-36 | T19 | AgentColumnCard.test (failed error, others intact) |
| AC-37 | T17, T19 | helpers.test (alsoFlaggedBy), AgentColumnCard.test |
| AC-38 | T19, T20, T18 | AgentColumnCard.test, AgentTabsView.test (drawer runId + running flag) |
| AC-39 | T20 | AgentTabsView.test (tabs, header, FindingCard actions) |
| AC-40 | T20 | AgentTabsView.test (accept call + state; same `["reviews", prId]` query) |
| AC-41 | T17, T18 | MultiAgentResults.test (?view=tabs), helpers.test (fallback) |
| AC-42 | T11, T18, T22 | MultiAgentResults.test (loading/404/500), multi-agent.test hook (404 no retry) |
| AC-43 | T21, T22 | DisagreementsBlock.test (cells) |
| AC-44 | T17, T21 | DisagreementsBlock.test (switch), helpers.test (groupsToShow) |
| AC-45 | T21, T22 | DisagreementsBlock.test (all agree) |
| AC-46 | T17, T21, T22 | DisagreementsBlock.test (fewer than two finished) |
| AC-47 | T1, T2, T10 | contracts-multi-agent.test, contracts-parity.test (observability.ts, review-api.ts, platform.ts), server + client typecheck |

No AC is unmapped.

## 6. Risks and assumptions

- **D-1 needs the user's acknowledgement** (visible scope only in columns and groups). If the user wants every persisted finding, the change is one filter in `read-model.ts`.
- **Provider rate limits with 5 concurrent agents (A-2).** A limit hit surfaces as that agent's `failed` column only. There is no cap; the researcher note in the spec stays open.
- **Concurrent writes.** `markReviewed(pull.id, headSha)` runs once per agent concurrently. It is idempotent, so the race is accepted.
- **Migration ordering with worktree B.** A's `0016_*` merges first. B must regenerate its own migration after rebasing, never renumber by hand. Shared expected conflicts: `nav.ts`, `modules/index.ts`, migration journal.
- **Vendored edits are authorised only for** the three contract files (AC-47) and the one `nav.ts` WORKSPACE item (spec "Ownership"). Nothing else in `vendor/` changes.
- **`providers.tsx` (D-4)** is a shared client file. The change is one extra early-return condition, and other mutations are unaffected.
- **Grouping cost.** It is quadratic, on read only (NFR: 5 x 50 findings is 62k pair checks, which is negligible).
- **The boot reaper** sets `failed` without error text. The column then shows "Failed" with an empty error; this is accepted (pre-existing).
- Out of scope: reviewer-core, `ci/`, `agent-runner/`, `.github/workflows/`, e2e flows, seed data, a list page of multi-agent runs, cancel from the multi-agent page, the Learn action.

## 7. Validation

Commands (each gate, and the final check by plan-verifier):
- `server/`: `pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- `client/`: `pnpm typecheck` and `pnpm test`

Test strategy:
- Pure functions (grouping, read model, estimates, client helpers) get table-style unit tests.
- Routes use `buildApp` + `app.inject` with in-memory repository spies.
- The executor uses the mocked `reviewPullRequest` / `loadDiff` pattern of `run-executor.scope.test.ts`, with deferred promises for AC-19.
- Client components use RTL with mocked hooks and the real message files.
- The polling hook uses fake timers.

Manual check (optional, local stack): launch 3 agents on a seeded PR and watch the columns switch to Done or Failed without a reload. Then open "View trace" on a running column (live log) and on a done one (trace).

Breaking changes: none.
- The contracts change additively; the new nullable widenings (`AgentColumn.agent_id`, `ConflictTake.agent_id`) have no existing producer.
- The migration adds one nullable column.
- Old `POST /pulls/:id/review` bodies behave the same, except that "Run all" now runs agents in parallel (A-2, intended).

## 8. Execution mode (DECIDED: multi-agent via `run-plan`)

| Wave | Phase | Agent | Depends on | Parallel with |
|---|---|---|---|---|
| 0 | P1 Contracts + DB schema | implementer | none | none (alone; freezes contracts and migration) |
| 1 | P2 Server | implementer | P1 | P3 |
| 1 | P3 Client launch + Configure run | implementer | P1 | P2 |
| 2 | P4 Client results page | implementer | P3 (hooks, helpers, `multiAgent.json` hand-over) | P2 if still running |
| 3 | P5 Tests | test-writer | P2, P4 | none |
| 4 | Review | architecture-reviewer | P5 | none |
| 5 | Fixes | implementer (max 2 fix subagents in total across review and verification) | reviewer / verifier findings | none |
| 6 | Verification | plan-verifier | fixes | none |

File ownership is disjoint inside each wave:
- P1 owns the six contract copies, `schema/runs.ts` and the generated migration.
- P2 owns `server/src/modules/reviews/{routes,service,run-executor,repository}.ts`, `reviews/repository/run.repo.ts`, `server/src/modules/multi-agent/**`, `server/src/modules/index.ts` and `server/README.md`.
- P3 owns:
  - `client/src/lib/hooks/{multi-agent,index}.ts`, `client/src/lib/providers.tsx`;
  - `multi-agent/page.tsx`, `multi-agent/_components/ConfigureRun/**`;
  - `RunReviewDropdown.tsx`, `PrDetailHeader.tsx`, `pulls/[number]/page.tsx`;
  - `vendor/ui/nav.ts`, `messages/en/prReview.json`, and `messages/en/multiAgent.json` (created).
- P4 owns `multi-agent/[id]/page.tsx`, `multi-agent/_components/{MultiAgentResults,AgentColumnCard,AgentTabsView,DisagreementsBlock}/**`, `client/README.md`, and `messages/en/multiAgent.json` (sequential hand-over from P3; it adds `results.*` and `disagreements.*` only).
- P5 owns test files only.

Why multi-agent:
- The server and the client launch flow depend only on the frozen P1 contracts, so P2 and P3 run in parallel safely.
- P4 is sequential after P3 only because the spec puts all multi-agent hooks in one file and all strings in one namespace file.
- The single-agent alternative is P1 -> P2 -> P3 -> P4 -> P5: the same tasks, slower.

Fix-loop budget: at most 2 fix subagents in total, after the architecture-reviewer and plan-verifier findings. Anything left after that is reported to the user, not fixed.
