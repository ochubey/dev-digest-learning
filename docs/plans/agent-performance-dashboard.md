# Plan: Agent Performance Dashboard (SPEC-06)

Spec: `specs/06-agent-performance-dashboard.md` (approved; OQ-1..OQ-3 accepted in its Resolutions). Branch `l08-agent-performance`.
Execution: three sequential implementer runs (A = P0-P2 server, B = P3-P4 client helpers and Stats tab, C = P5-P7 dashboard, sidebar, e2e, docs, verification). Tests first in every task. The implementer does not commit; the coordinator commits per run.
Vendor boundary: only T1 (both `observability.ts` copies) and T14 (`client/src/vendor/ui/nav.ts`) touch read-only vendored files; no other `vendor/` file changes.

## Confirmed facts

- `server/test/contracts-parity.test.ts` already checks that `observability.ts` is byte-identical in both copies; P1 keeps it green.
- `AgentStats` is at `contracts/observability.ts:137` (both copies); nothing produces it yet.
- `decisionOf` is private to `server/src/modules/evals/service.ts:335`: re-implement it, do not touch the evals module.
- `activeKeyFor('/agent-performance')`, `nav.agent-performance`, `editor.tabs.stats`, `agentPerformance.*`, `runs.stats.*` already exist.
- The client imports only types from `@devdigest/shared`; the dashboard envelope is mirrored as a client type (D-2).
- Test styles: `startPg`/`dockerAvailable` (`describe.skip` without Docker) for integration; `buildApp` + `app.inject` with prototype spies for routes.
- The fixture seed has one `done` run, cost null (`server/src/db/seed.ts:748`): e2e compares values against each other, not absolute counts.
- No index migration unless the P7 timing check fails (then edit `schema/runs.ts` and `pnpm db:generate`, never hand-edit migrations).

## Design

Server module `server/src/modules/agent-performance/` (read-only): `constants.ts` (LOW_SAMPLE_MIN=5, MAX_RANGE_DAYS=366, DEFAULT_DAYS=30, UNKNOWN_MODEL='unknown', COST_BASIS='estimate'); `period.ts` (PeriodQuery zod: both-or-none, valid ISO with Z/offset, from<to, <=366 d; `resolvePeriod(q, now)`; echo via toISOString); `rules.ts` (pure: decisionOf copy, isRatedScope in/null, rate, buildAgentStats, buildTrend, buildTotals, mostActive, costByAgent, normalizeModel, costByModel); `schemas.ts` (AgentPerformance envelope, `agents[]` reuse AgentStats); `repository.ts` (select only, grouped per agent, optional agent filter, fixed number of queries, findings attributed through `reviews.run_id = agent_runs.id` to `agent_runs.agent_id`, decision CASE mirrors decisionOf, days bucketed by `date_trunc('day', ran_at AT TIME ZONE 'UTC')`, everything scoped by `agent_runs.workspace_id`); `service.ts` (one private `aggregate(ws, period, agentIds)` feeds both `agentStats` (404 if the agent is not in the workspace) and `dashboard`, so AC-20 holds by construction); `routes.ts` (`GET /agents/:id/stats`, `GET /agent-performance`, one `req.log.info` line each). Register in `modules/index.ts`.

Client: hooks `client/src/lib/hooks/agent-performance.ts` (`useAgentPerformance({from,to})` key `["agent-performance", from, to]`, `useAgentStats(id,{from,to})`; GET only); shared dir `client/src/components/agent-performance/` (`period.ts`, `format.ts`, `sort.ts`, `breakdown.ts`, `types.ts`, components `PeriodPicker`, `EstimateLabel`, `AcceptRate`, `LastRun`, `MetricSkeleton`); Stats tab under `AgentEditor/_components/StatsTab/`; dashboard `client/src/app/agent-performance/page.tsx` + `_components/AgentPerformanceView/` with `SummaryCards`, `AgentTable`, `CostBreakdown`, `EmptyState`. A shared fixture `client/src/test/fixtures/agent-performance.sample.json` is parsed by a server test (strict schema) and checked by a client test against the mirrored type.

## Tasks

Format: id what | files | AC | verify. S = `cd server`, C = `cd client`. Unit run = `pnpm exec vitest run --exclude '**/*.it.test.ts'`.

### Run A

- P0 T0 Record the baseline (counts of tests and files for S typecheck, S unit run, parity test, C typecheck, C test; `git diff --stat main...HEAD -- client/src/vendor server/src/vendor` expected empty). Any red that is already red here is pre-existing.
- P1 T1 [VENDOR] Add to `AgentStats`: `period_from`, `period_to` (ISO), `runs_excluded`, `runs_with_cost`, `runs_without_cost`, `decisions`, `low_sample`, `last_run_at`, `last_run_at_all_time` (ISO or null), `cost_basis: z.literal('estimate')`; update doc comments; both copies byte-identical | both `observability.ts`, `server/test/contracts-agent-stats.test.ts` | AC-16, AC-76 | `S: pnpm typecheck && pnpm exec vitest run test/contracts-*.test.ts`; `C: pnpm typecheck`.
- P1 T2 `AgentPerformance` envelope zod, client mirror type and shared fixture | `schemas.ts`, `types.ts`, fixture, `server/test/agent-performance-contract.test.ts`, `client/src/test/contracts-agent-performance.test.ts` | AC-16, AC-19.
- P2 T3 `constants.ts`, `period.ts` | `server/test/agent-performance-period.test.ts` (from>=to, 367 d, invalid ISO, only from or only to rejected; none gives [now-30d, now); +02:00 echoed as UTC Z; at from in, at to out, to-1ms in) | AC-4, AC-21, AC-22, AC-23.
- P2 T4 `rules.ts` | `server/test/agent-performance-rules.test.ts` (decisionOf 4 combos + tie accepted; 3/1/6 gives 0.75, 0.25, decisions 4; 0 decisions gives null rates; low_sample at 0/4/5; findings totals and severities; cost sums with nulls; avg cost and duration ignore nulls; trend per UTC day; totals equal per-agent sums; pooled rate differs from mean of rates; most-active ties by name; cost_by_agent and cost_by_model sums with blank or null model as unknown) | AC-6..13, AC-15, AC-24..29.
- P2 T5 `repository.ts` + integration test with two workspaces; done/failed/cancelled/running/null-status rows; local and ci; a deleted agent (null agent_id); boundary `ran_at`; one finding per scope; both-timestamp findings; an agent never run; an agent run only before the period | `server/test/agent-performance.it.test.ts` (skipped without Docker): only done non-null-agent in-period runs counted, runs_excluded counted, deleted_agent_runs reported, boundaries, only in/null scope rated, SQL decisions equal decisionOf, last_run_at vs all-time, dashboard entry deep-equals `/agents/:id/stats` for 1 d, 30 d, custom, GETs change no row counts or `updated_at`, other workspace never counted | AC-1..6, AC-14, AC-20, AC-71, AC-74.
- P2 T6 `service.ts`, `routes.ts`, register in `modules/index.ts` | `server/test/agent-performance-routes.test.ts` (fake repository via prototype spies: 200 shapes, 404 for unknown or other-workspace agent, 3 agents with 1 without runs gives 3 entries, 422 validation_error on both endpoints with repository never called, default period with `vi.setSystemTime`, offset echo, POST/PUT/DELETE 404 or 405, LLM provider, embedder, GitHub client and run executor overridden to throw while GETs stay 200, workspace id passed to every repository call) | AC-16..19, AC-21..23, AC-71, AC-72, AC-74.

### Run B

- P3 T7 Hooks, re-export from `hooks/index.ts` | `agent-performance.test.tsx` (GET only, correct URLs and query) | AC-62, AC-67, AC-73.
- P3 T8 `period.ts` (parsePeriodParams, presetPeriod, customPeriod, validateCustom, toSearchParams) | tests: 1d/30d from a fixed now, custom Sep 1-30 gives 09-01T00Z to 10-01T00Z, start>end and >366 d invalid with reason, URL round trip, `?range=7d` or bad date falls back to 30d | AC-32..36.
- P3 T9 `format.ts` (USD: `$0.0004` never `$0.00`; duration "14.2 s", "1 m 05 s"; null gives an em dash; rate), `sort.ts` (default runs desc then name; accept-rate sort puts agents with enough decisions first, 1/1 below 6/10 both directions, n/a by name; nulls last), `breakdown.ts` (shares from unrounded values) | AC-43..50, AC-56.
- P3 T10 Shared components with their `agentPerformance.json` keys (`period.*`, `cost.*`, `rate.*`, `lastRun.*`): `PeriodPicker` (three options, 30d default, Apply disabled with a reason), `EstimateLabel` (focusable legend text per AC-58), `AcceptRate` (0/3/8 decisions), `LastRun`, `MetricSkeleton` (`aria-busy`); agent names rendered as literal text | AC-31, AC-34, AC-43, AC-50, AC-58, AC-75.
- P4 T11 Add the `stats` entry to `TABS` and build `StatsTab` (period from URL `from`/`to` or last 30 days, PeriodPicker, applied period shown, metrics, states: skeleton, error with Retry, no runs, never run); extend `runs.json` `stats.*` | tests: `?tab=stats` deep link, exact URL window requested, metric texts equal the dashboard-row fixture texts, fetch spy sees only GET `/agents/:id/stats` | AC-58, AC-66..70, AC-73.

### Run C

- P5 T12 Dashboard page and `AgentPerformanceView`: URL period (`?range=1d|30d|custom&start&end`), applied-period line with counted and excluded runs, four cards (Total runs, Total cost, Avg accept rate, Most-active agent), loading, error with Retry, empty state (no runs; no agents with a link to `/agents`) | AC-31, 32, 35..41, 60..64, 73.
- P5 T13 `AgentTable`: sortable header buttons (`aria-sort`), expand button (`aria-expanded`, accessible name contains the agent), details from loaded data only, View link with the exact response instants; three distinct Last run texts; zero-run row; no empty column headings; XSS names literal | AC-42..54, 65, 75.
- P5 T14 [VENDOR] One `NAV` item `{ key:"agent-performance", label:"Agent Performance", icon:"BarChart", href:"/agent-performance" }` in SKILLS LAB after `eval` | `client/src/test/nav-agent-performance.test.tsx` | AC-30, AC-77.
- P5 T15 `CostBreakdown` (by agent and by model, shares, footer equals the card text, "No cost recorded yet.") | AC-55..58.
- P5 T16 Finish `agentPerformance.json`; replace the contradicting `subtitle` and `sort.cost` texts; add a copy-scan test (no billed, actual, invoiced, reconciled outside the legend's negative sentence) | AC-58, AC-59.
- P6 T17 e2e `e2e/specs/15-agent-performance.flow.json` (deterministic, no LLM): sidebar click, cards and a row render, read the Security Reviewer row runs text, View, assert the Stats tab equals it, then a custom range with no runs shows the empty state; add to `e2e/specs/flows.md` | AC-20, 30, 52, 63, 69.
- P6 T18 Docs: `server/README.md` (two routes and query rules), `client/README.md` (route row and the `?tab=stats` note), `specs/README.md` (SPEC-06 and plan), `e2e/README.md` (coverage line).
- P7 T19 Gates compared with T0: server typecheck, unit run, integration test and parity; client typecheck and test; `diff` of both `observability.ts` empty; `git diff --stat main...HEAD -- client/src/vendor server/src/vendor` lists only the two `observability.ts` files and `nav.ts` | AC-76, 77.
- P7 T20 No-model-call checks: grep client dashboard, shared dir, Stats tab and hook for `useMutation|method:|POST` returns nothing; grep the server module for `llm|embedder|github|executor` returns nothing; the GET-only spy tests and the throwing-container test are green | AC-72, 73.
- P7 T21 Manual demo script on the local stack (`./scripts/dev.sh`): dashboard with data, note one agent's runs, avg cost, avg duration, accept rate; View shows the same values in the Stats tab for the same window; a custom range with no runs shows the empty state; stop the API and reload for the error state with no zeros, then start it and Retry; in the network panel only GETs and no new `agent_runs` row; optionally time `GET /agent-performance` | AC-20, 60..63, 70..73.

## Coverage (AC to tasks)

AC-1..3 T5; AC-4 T3,T5; AC-5 T5; AC-6 T4,T5; AC-7..13 T4; AC-14 T5; AC-15 T4; AC-16 T1,T2,T6; AC-17,18 T6; AC-19 T2,T6; AC-20 T5,T17,T21; AC-21..23 T3,T6; AC-24..29 T4; AC-30 T14,T17; AC-31 T10,T12; AC-32 T8,T12; AC-33 T8; AC-34 T8,T10; AC-35,36 T8,T12; AC-37..41 T12; AC-42 T13; AC-43 T9,T10,T13; AC-44,45 T9,T13; AC-46..49 T9,T13; AC-50 T9,T10,T13; AC-51 T13; AC-52 T13,T17; AC-53,54 T13; AC-55 T15; AC-56 T9,T15; AC-57 T15; AC-58 T10,T11,T15,T16; AC-59 T16; AC-60,61 T12,T21; AC-62 T7,T12; AC-63 T12,T17; AC-64 T12; AC-65 T13; AC-66..69 T11 (AC-69 also T17); AC-70 T11,T21; AC-71 T5,T6; AC-72 T6,T20; AC-73 T7,T11,T12,T20; AC-74 T5,T6; AC-75 T10,T13; AC-76 T1,T19; AC-77 T14,T19.

## Risks

SQL and TypeScript decision rules can drift: T5 pins the CASE against decisionOf with both-timestamp and tie rows. The dashboard envelope is mirrored on the client: the shared fixture is tested on both sides. Presets recompute "now" on reload (AC-35); the View link carries absolute instants. Out of scope: reviewer-core, agent-runner, CI workflows, the price book, charts, filters, writes.
