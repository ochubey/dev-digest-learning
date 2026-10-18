# Spec: Agent Performance Dashboard
Spec ID: SPEC-06
Status: approved

Revision note: rev 1, first draft for the L08 homework (branch `l08-agent-performance`). The homework requirements are quoted in "Requirements coverage". The owner's decisions and the adopted defaults are recorded under "Decisions" (D-1..D-24); no item in this spec is left as `[NEEDS CLARIFICATION]`. Own implementation: nothing is copied from the course reference branch.

## Problem and user

A DevDigest workspace runs several review agents, locally and in CI (SPEC-05), alone and in multi-agent runs (SPEC-04). Each run stores its model, duration, cost estimate and status, and every finding a human accepts or dismisses stores that decision. Nothing in the studio puts these facts together. The owner cannot answer simple questions: which agent runs most, which one is useful (its findings get accepted), what the agents cost and on which models the money goes.

The per-agent Stats tab and its endpoint that the homework refers to ("the same API and aggregation rules as the agent Stats tab") do not exist in this branch; only the `AgentStats` contract and unused i18n strings exist. This spec therefore defines the aggregation rules once, serves them through one shared aggregation behind two endpoints, and adds both a minimal per-agent Stats tab (the cross-check) and the workspace-wide dashboard.

User: the workspace owner or team lead who tunes agents. They (1) open Agent Performance from the sidebar, (2) pick a period (1 day, 30 days or a custom range), (3) read the totals, the per-agent table and the cost breakdowns, (4) sort the table, expand a row, and (5) open one agent's Stats tab for the same period and see the same numbers.

The dashboard is read-only. It never starts a review or a model call; it reads stored runs and findings.

## Goals / Non-goals

### Goals

- **G1 Navigation.** An "Agent Performance" item in the global sidebar opens `/agent-performance`.
- **G2 Period.** The user picks 1 day, 30 days (default) or a custom date range; every number on the page is computed for that period, and the period plus the number of counted runs is always visible.
- **G3 Summary.** Four cards: Total runs, Total cost, Avg accept rate, Most-active agent.
- **G4 Per-agent table.** Columns Agent, Runs, Avg cost, Avg duration, Accept rate, Last run, View; sortable; accept-rate denominator always shown; small samples marked and never ranked by their rate; a row can be expanded.
- **G5 Cost breakdowns and honesty.** Cost by agent and cost by model, each adding up to Total cost; every cost is labelled as a DevDigest estimate, and the page states that no reconciled billing data exists.
- **G6 One aggregation, two endpoints, cross-check.** One aggregation service with documented rules serves `GET /agents/:id/stats` and `GET /agent-performance`; a minimal Stats tab on the agent page shows the per-agent numbers, which match the dashboard row for the same period.
- **G7 States.** Loading, error, completely empty dashboard, agent with no runs in the period and agent that has never run are distinct, correct states; loading and error never show invented zeros.
- **G8 Read-only, no model calls.** Both endpoints are GET-only, write nothing and call no model; loading, reloading, sorting and expanding never start a review or a model call.
- **G9 Change boundaries.** Shared/vendored files change only where the owner allowed it: the `AgentStats` contract (additive, both copies, parity test green) and one `NAV` item.

### Non-goals

- Reconciling costs with provider invoices or OpenRouter billing exports. There is no billing data in the system; costs are estimates (D-15).
- Repository, source (local/CI), model or PR filters. The dashboard is workspace-wide (D-17).
- Charts and trend visualizations on the dashboard (the `trend` field is filled but not drawn, D-21), CSV export, pagination of the agent table.
- Accept-rate history per run, per-finding drill-down, links from the dashboard to individual findings or runs.
- Quality signals other than accept/dismiss (eval scores, grounding drop rate, conflict rate).
- Per-agent cost-by-model breakdown inside the expanded row.
- Caching, materialized views or background aggregation jobs.
- Any new write path: no setting, no saved period, no "recompute" action.
- A new top-level sidebar section; the item joins an existing group (D-3).
- Counting runs of deleted agents in any total (D-6).
- Changes to `reviewer-core`, `agent-runner`, the review flow, the price book or how cost is recorded.

## User stories

- **US-1 (G1, G2, G3).** As a team lead, I open Agent Performance and see, for the last 30 days, how many runs my agents made, what they cost (as an estimate) and how often their findings were accepted.
- **US-2 (G2).** As a team lead, I switch to 1 day to see today's activity, or pick a custom date range to look at last month.
- **US-3 (G4).** As a team lead, I sort agents by accept rate and trust the order, because agents with fewer than 5 decisions are shown after the ranked ones and marked "low sample".
- **US-4 (G4).** As a team lead, I see next to each accept rate how many decisions it is based on, and how many runs the agent made in the period.
- **US-5 (G5).** As a budget owner, I see which agents and which models account for the cost, and the parts add up to the total.
- **US-6 (G5).** As a budget owner, I understand that every amount is a DevDigest estimate (provider-reported or price-book), not an invoice.
- **US-7 (G6).** As an agent owner, I click View on a row and the agent's Stats tab shows the same runs, cost, duration and accept rate for the same period.
- **US-8 (G7).** As a new user with no runs yet, I see an empty state that tells me how to get data, not a table of zeros.
- **US-9 (G8).** As a cost-conscious user, I can reload, sort and expand rows as often as I like without spending a token.

## Definitions (aggregation rules)

These rules are the single source of truth for both endpoints (G6). All times are UTC.

- **Period.** A half-open interval `[from, to)` of instants. A run belongs to the period when `from <= agent_runs.ran_at < to` (D-9).
- **Counted run.** An `agent_runs` row of the current workspace with `status = 'done'`, a non-null `agent_id`, any `source` (`local` or `ci`), and `ran_at` in the period (D-5).
- **Excluded run.** An `agent_runs` row of the workspace with a non-null `agent_id` and `ran_at` in the period whose `status` is anything other than `'done'` (`failed`, `cancelled`, `running`, null or any other value). Excluded runs contribute nothing except their count (D-5).
- **Deleted-agent run.** An `agent_runs` row in the period with `agent_id` null (agent deleted, existing `set null`). Not counted anywhere; only its count is reported (D-6).
- **Rated finding.** A `findings` row whose review (`reviews.run_id`) is a counted run, and whose `scope` is `'in'` or null. Findings with scope `'out'` or `'signal'` are not rated (D-10).
- **Decision of a rated finding** (same rule as `decisionOf` in the evals module, D-11): accepted when only `accepted_at` is set; dismissed when only `dismissed_at` is set; when both are set, the later timestamp wins and a tie counts as accepted; pending when neither is set.
- **Decisions** = accepted + dismissed. **Accept rate** = accepted / decisions; null ("n/a") when decisions = 0. **Dismiss rate** = dismissed / decisions; null when decisions = 0. Pending findings are never in the denominator (D-12).
- **Low sample.** decisions < 5. An agent with 1..4 decisions shows its rate marked "low sample"; an agent with 0 decisions shows "n/a" (D-13).
- **Total cost** = sum of non-null `cost_usd` of counted runs; null when no counted run has a cost. **Runs with cost** / **runs without cost** = counted runs with non-null / null `cost_usd` (D-14).
- **Avg cost** = total cost / runs with cost; null when runs with cost = 0. **Avg duration** = mean `duration_ms` over counted runs with non-null `duration_ms`; null when there are none (D-14).
- **Cost by agent** = total cost per agent; **cost by model** = total cost per `agent_runs.model` after trimming whitespace, with null or blank model grouped as `unknown`, other strings grouped exactly (no case folding or alias merging) (D-16).
- **Last run (in period)** = max `ran_at` of the agent's counted runs in the period; **last run (all time)** = max `ran_at` of the agent's runs with `status = 'done'` regardless of period (D-18).
- **Most-active agent** = the agent with the most counted runs in the period; ties broken by agent name ascending (case-insensitive, then by id); none when there are no counted runs (D-19).
- **Summary accept rate** = pooled: sum of accepted / sum of decisions over all counted runs of all agents (not a mean of per-agent rates); low sample when the pooled decisions < 5 (D-20).

## Data contracts

Described as external contracts; field names are normative, placement is fixed by D-2.

**`AgentStats` (existing contract, extended additively, D-1).** Existing fields keep their names and types and get these meanings: `runs` = counted runs; `findings_total` = rated findings (accepted + dismissed + pending); `accepted`, `dismissed`, `pending`; `accept_rate`, `dismiss_rate`; `avg_findings_per_run` = findings_total / runs (null when runs = 0); `total_cost_usd`, `avg_cost_usd`; `avg_latency_ms` = avg duration; `findings_by_severity` over rated findings; `trend` = one point per UTC day of the period with label `YYYY-MM-DD` and value = counted runs that day, oldest to newest (D-21). New fields:

| Field | Type | Meaning |
|---|---|---|
| `period_from`, `period_to` | ISO-8601 instant strings | The applied period `[from, to)` |
| `runs_excluded` | int | Excluded runs of this agent in the period |
| `runs_with_cost`, `runs_without_cost` | int | Counted runs with / without a cost |
| `decisions` | int | accepted + dismissed (the accept-rate denominator) |
| `low_sample` | boolean | decisions < 5 |
| `last_run_at` | ISO instant or null | Last run in the period |
| `last_run_at_all_time` | ISO instant or null | Last done run ever; null = never run |
| `cost_basis` | literal `'estimate'` | Every cost in this object is a DevDigest estimate |

**`GET /agents/:id/stats?from=&to=`** returns one `AgentStats`.

**`GET /agent-performance?from=&to=`** returns:

```
{
  period: { from, to },                       // applied period
  cost_basis: 'estimate',
  totals: {
    runs, runs_excluded, deleted_agent_runs,
    total_cost_usd | null, runs_with_cost, runs_without_cost,
    accepted, dismissed, decisions,
    accept_rate | null, low_sample
  },
  most_active: { agent_id, agent_name, runs } | null,
  agents: AgentStats[],                       // every agent of the workspace
  cost_by_agent: [{ agent_id, agent_name, cost_usd, runs_with_cost }],
  cost_by_model: [{ model, cost_usd, runs_with_cost }]
}
```

Query parameters for both endpoints: `from` and `to` as ISO-8601 instants (with `Z` or an offset). Both omitted = the last 30 days ending at request time. Validation errors answer 422 with the app's existing `validation_error` shape.

## Acceptance criteria (EARS)

Each AC names its goal(s). Verification hints are in italics. "Aggregation" means the shared service behind both endpoints.

### Aggregation rules (G6)

- **AC-1 (G6).** The aggregation (shall) count as runs only `agent_runs` rows of the current workspace with `status = 'done'`, a non-null `agent_id` and `ran_at` in the period, from both sources `local` and `ci`.
  *Verify:* Service integration test (`.it.test`) with done/failed/cancelled/running/null-status rows, local and ci, inside and outside the period; asserts `runs`.
- **AC-2 (G6).** The aggregation (shall) report, per agent and in total, the number of excluded runs (non-null agent, in period, status other than `done`) and (shall) use them for nothing else.
  *Verify:* Same fixture; asserts `runs_excluded` and that their cost, duration and findings change no other field.
- **AC-3 (G6).** The aggregation (shall) leave runs with a null `agent_id` out of every count, cost and rate, and (shall) report their number as `totals.deleted_agent_runs`.
  *Verify:* Integration test with a run whose agent was deleted; totals and breakdowns unchanged, `deleted_agent_runs = 1`.
- **AC-4 (G2, G6).** The aggregation (shall) include a run when `from <= ran_at < to` and exclude it otherwise.
  *Verify:* Integration test with runs exactly at `from`, at `to` and 1 ms before `to`.
- **AC-5 (G4, G6).** The aggregation (shall) rate only findings of counted runs (joined through the review's run) whose scope is `in` or null, and (shall) ignore findings with scope `out` or `signal`.
  *Verify:* Integration test with one finding per scope value, each accepted; asserts `accepted`.
- **AC-6 (G4, G6).** The aggregation (shall) classify each rated finding as accepted, dismissed or pending by the `decisionOf` rule, including "later timestamp wins, tie = accepted" for findings with both timestamps.
  *Verify:* Unit test of the classifier with the four timestamp combinations and the tie; integration test asserting the counts.
- **AC-7 (G4, G6).** The aggregation (shall) return `accept_rate = accepted / (accepted + dismissed)`, `dismiss_rate = dismissed / (accepted + dismissed)` and `decisions = accepted + dismissed`, with pending findings in neither numerator nor denominator.
  *Verify:* Unit test: 3 accepted, 1 dismissed, 6 pending gives 0.75, 0.25, decisions 4.
- **AC-8 (G4, G6).** ЯКЩО decisions = 0, ТОДІ the aggregation (shall) return `accept_rate` and `dismiss_rate` as null, not 0.
  *Verify:* Unit test with only pending findings and with no findings.
- **AC-9 (G4, G6).** The aggregation (shall) set `low_sample` to true when decisions < 5 and false otherwise.
  *Verify:* Unit test at 0, 4 and 5 decisions.
- **AC-10 (G6).** The aggregation (shall) return `findings_total = accepted + dismissed + pending` over rated findings, `findings_by_severity` over the same findings, and `avg_findings_per_run = findings_total / runs` (null when runs = 0).
  *Verify:* Unit test with a mixed-severity fixture.
- **AC-11 (G5, G6).** The aggregation (shall) return `total_cost_usd` as the sum of non-null `cost_usd` of counted runs, and null when no counted run has a cost.
  *Verify:* Unit test: costs 0.01, null, 0.02 give 0.03; all-null gives null; one run with cost 0 gives 0.
- **AC-12 (G5, G6).** The aggregation (shall) return `runs_with_cost` and `runs_without_cost` and `avg_cost_usd = total_cost_usd / runs_with_cost` (null when runs_with_cost = 0), so a run without cost never lowers the average.
  *Verify:* Unit test: costs 0.01, null, 0.03 give avg 0.02, runs_without_cost 1.
- **AC-13 (G4, G6).** The aggregation (shall) return `avg_latency_ms` as the mean `duration_ms` of counted runs with a non-null duration, rounded to the nearest integer, and null when there is none.
  *Verify:* Unit test with a null duration among values.
- **AC-14 (G4, G6).** The aggregation (shall) return `last_run_at` as the latest `ran_at` of the agent's counted runs in the period (null when none) and `last_run_at_all_time` as the latest `ran_at` of its `done` runs regardless of period (null when the agent never completed a run).
  *Verify:* Integration test: agent with a done run before the period only gives `last_run_at` null and `last_run_at_all_time` set; never-run agent gives both null.
- **AC-15 (G6).** The aggregation (shall) return `trend` with one point per UTC day touched by the period, oldest first, labelled `YYYY-MM-DD`, valued with that day's counted runs.
  *Verify:* Unit test for a 3-day period with runs on days 1 and 3 (day 2 = 0).
- **AC-16 (G5, G6).** Every `AgentStats` and the dashboard response (shall) carry `cost_basis: 'estimate'`.
  *Verify:* Route tests assert the field.

### Endpoints (G6, G2)

- **AC-17 (G6).** КОЛИ a client calls `GET /agents/:id/stats` with a valid period, the system (shall) answer 200 with one `AgentStats` for that agent and that period, validated by the shared schema.
  *Verify:* Route test parses the body with `AgentStats`.
- **AC-18 (G6).** ЯКЩО the agent id does not exist in the current workspace, ТОДІ `GET /agents/:id/stats` (shall) answer 404 with the app's not-found error.
  *Verify:* Route test with a random uuid and with an agent of another workspace.
- **AC-19 (G6).** КОЛИ a client calls `GET /agent-performance` with a valid period, the system (shall) answer 200 with the dashboard contract, whose `agents` array contains one `AgentStats` for every agent of the workspace, including agents with no runs.
  *Verify:* Route test with three agents, one without runs; asserts three entries.
- **AC-20 (G6).** For every agent and every period, the `AgentStats` entry in `GET /agent-performance` (shall) be equal, field by field, to the body of `GET /agents/:id/stats` with the same `from` and `to`.
  *Verify:* Integration test over a seeded fixture for 1-day, 30-day and custom periods, deep-equal per agent.
- **AC-21 (G2, G6).** ЯКЩО `from >= to`, the range exceeds 366 days, either value is not a valid ISO-8601 instant, or only one of the two is given, ТОДІ both endpoints (shall) answer 422 `validation_error` and compute nothing.
  *Verify:* Route test per case for both endpoints.
- **AC-22 (G2, G6).** КОЛИ both `from` and `to` are omitted, both endpoints (shall) use the 30 days ending at request time.
  *Verify:* Route test with a fixed clock asserts the echoed period.
- **AC-23 (G2, G6).** Both endpoints (shall) echo the applied period (`period_from`/`period_to`, `period.from`/`period.to`) as UTC ISO instants.
  *Verify:* Route test with an offset input (`+02:00`) asserts the UTC echo.

### Dashboard totals and breakdowns (G3, G5)

- **AC-24 (G3).** `totals.runs` (shall) equal the sum of `runs` over `agents`, and `totals.accepted`, `totals.dismissed`, `totals.decisions`, `totals.runs_excluded`, `totals.runs_with_cost` and `totals.runs_without_cost` (shall) equal the sums of the matching per-agent fields.
  *Verify:* Property-style unit test over random fixtures.
- **AC-25 (G3).** `totals.accept_rate` (shall) be `totals.accepted / totals.decisions` (pooled), null when `totals.decisions = 0`, with `totals.low_sample` true when `totals.decisions < 5`.
  *Verify:* Unit test where the pooled rate differs from the mean of per-agent rates.
- **AC-26 (G3).** `most_active` (shall) be the agent with the most counted runs in the period, ties broken by agent name ascending (case-insensitive, then id), and null when `totals.runs = 0`.
  *Verify:* Unit test with a tie ("beta" vs "Alpha"), and with zero runs.
- **AC-27 (G5).** `cost_by_agent` (shall) list every agent with `runs_with_cost > 0`, ordered by cost descending then name, and the sum of its `cost_usd` values (shall) equal `totals.total_cost_usd`.
  *Verify:* Unit test asserts the sum with a tolerance of 1e-9 and the order.
- **AC-28 (G5).** `cost_by_model` (shall) group counted runs with a cost by trimmed `model`, with null or blank model as `unknown`, ordered by cost descending then model, and the sum of its `cost_usd` values (shall) equal `totals.total_cost_usd`.
  *Verify:* Unit test with models `"a"`, `" a "`, `""`, null and `"A"`; asserts groups `a`, `A`, `unknown` and the sum.
- **AC-29 (G5).** `totals.total_cost_usd` (shall) equal the sum of `total_cost_usd` over `agents` (null entries skipped), and be null when every agent's total is null.
  *Verify:* Same property test as AC-24.

### Navigation and period selection (G1, G2)

- **AC-30 (G1).** The sidebar (shall) show an "Agent Performance" item (label from `nav.agent-performance`) that opens `/agent-performance` and is marked active on that route.
  *Verify:* Client test of the rendered nav and `activeKeyFor('/agent-performance')`.
- **AC-31 (G2).** The dashboard (shall) offer the period options "1 day", "30 days" and "Custom", with "30 days" selected when the URL carries no period.
  *Verify:* Page test asserts the three options and the default.
- **AC-32 (G2).** КОЛИ the user selects "1 day" or "30 days", the client (shall) request the period `to = now`, `from = now − 1 day` or `now − 30 days`, computed once at selection time.
  *Verify:* Page test with a fixed clock asserts the request query.
- **AC-33 (G2).** КОЛИ the user applies a custom range with a start date and an end date, the client (shall) request `from` = 00:00:00Z of the start date and `to` = 00:00:00Z of the day after the end date.
  *Verify:* Page test: 2026-09-01..2026-09-30 requests `2026-09-01T00:00:00.000Z` .. `2026-10-01T00:00:00.000Z`.
- **AC-34 (G2).** ПОКИ the custom start date is after the end date or the range is longer than 366 days, the client (shall) keep "Apply" disabled and show the reason.
  *Verify:* Page test for both cases.
- **AC-35 (G2).** The selected period (shall) be kept in the URL (`?range=1d|30d` or `?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD`), so a reload shows the same option; on reload a preset is recomputed from the current time.
  *Verify:* Page test renders with each URL form and asserts the selected option and the request.
- **AC-36 (G2).** ЯКЩО the URL carries an unknown or invalid period, ТОДІ the dashboard (shall) fall back to "30 days".
  *Verify:* Page test with `?range=7d` and with an invalid custom date.
- **AC-37 (G2).** The dashboard (shall) show the applied period as returned by the server, in UTC, and the text "<N> runs counted in this period", plus "<M> failed, cancelled or running runs not counted" when M > 0.
  *Verify:* Page test with a fixture where runs_excluded = 2.

### Summary cards (G3, G5)

- **AC-38 (G3).** The dashboard (shall) show a Total runs card with `totals.runs`.
  *Verify:* Page test.
- **AC-39 (G3, G5).** The dashboard (shall) show a Total cost card with `totals.total_cost_usd`, labelled "Estimate", and "<K> runs without cost not included" when `totals.runs_without_cost > 0`; ЯКЩО `totals.total_cost_usd` is null, ТОДІ the card (shall) show "No cost recorded" instead of an amount.
  *Verify:* Page test for both cases.
- **AC-40 (G3, G4).** The dashboard (shall) show an Avg accept rate card with the pooled rate and its denominator as "<accepted> of <decisions> decisions", "low sample" when `totals.low_sample` and decisions > 0, and "n/a · 0 decisions" when decisions = 0.
  *Verify:* Page test for 0, 3 and 12 decisions.
- **AC-41 (G3).** The dashboard (shall) show a Most-active agent card with the agent's name and its run count.
  *Verify:* Page test.

### Per-agent table (G4)

- **AC-42 (G4).** The table (shall) have the columns Agent, Runs, Avg cost, Avg duration, Accept rate, Last run and View, one row per entry of `agents`.
  *Verify:* Page test asserts header cells and row count.
- **AC-43 (G4).** The Accept rate cell (shall) show the rate as a percentage together with "<accepted>/<decisions>", add a "low sample" marker when decisions are 1..4, and show "n/a" with "0 decisions" when decisions = 0.
  *Verify:* Page test with three rows (0, 3, 8 decisions).
- **AC-44 (G4, G5).** The Avg cost cell (shall) show the amount marked as an estimate, and "—" when `avg_cost_usd` is null.
  *Verify:* Page test.
- **AC-45 (G4).** The Avg duration cell (shall) show a human duration (for example "14.2 s", "1 m 05 s"), and "—" when null.
  *Verify:* Unit test of the formatter; page test for null.
- **AC-46 (G4).** By default the table (shall) be sorted by Runs descending, ties by agent name ascending.
  *Verify:* Page test.
- **AC-47 (G4).** КОЛИ the user activates a sortable column header (Agent, Runs, Avg cost, Avg duration, Accept rate, Last run), the table (shall) sort by that column, toggle the direction on a repeated activation, and expose the state through `aria-sort`.
  *Verify:* Page test with clicks and the Enter key.
- **AC-48 (G4).** ПОКИ the table is sorted by Accept rate in either direction, the system (shall) list agents with decisions ≥ 5 first, ordered by rate in the chosen direction, then agents with 1..4 decisions (low sample) ordered by decisions descending then name, then agents with 0 decisions ordered by name; low-sample and n/a agents (shall) never be ordered by their rate.
  *Verify:* Page test: a 1/1 (100%) low-sample agent stays below a 6/10 agent in both directions.
- **AC-49 (G4).** ПОКИ the table is sorted by Avg cost, Avg duration or Last run, rows with a null value (shall) be placed last in both directions.
  *Verify:* Page test.
- **AC-50 (G4).** The Last run cell (shall) show `last_run_at`; ЯКЩО `last_run_at` is null and `last_run_at_all_time` is set, ТОДІ it (shall) show "No runs in period" with the all-time date; ЯКЩО both are null, ТОДІ it (shall) show "Never run".
  *Verify:* Page test with the three cases.
- **AC-51 (G4, G7).** ЯКЩО an agent has 0 counted runs in the period, ТОДІ its row (shall) show Runs "0", "—" for Avg cost and Avg duration, and "n/a · 0 decisions" for Accept rate.
  *Verify:* Page test.
- **AC-52 (G4, G6).** The View cell (shall) link to `/agents/<id>?tab=stats&from=<period.from>&to=<period.to>` using the exact instants returned by the dashboard response.
  *Verify:* Page test asserts the href.
- **AC-53 (G4, G8).** КОЛИ the user expands a row, the system (shall) show accepted, dismissed and pending counts, excluded runs, runs with and without cost, the agent's total cost (Estimate) and findings by severity, taken from the already loaded response, without sending any request.
  *Verify:* Page test with a fetch spy asserts no call on expand and the shown values.
- **AC-54 (G4).** The expand control (shall) be a button with `aria-expanded` and an accessible name containing the agent name.
  *Verify:* Page test with role queries.

### Cost breakdowns and labelling (G5)

- **AC-55 (G5).** The dashboard (shall) show a "Cost by agent" and a "Cost by model" breakdown, each entry with name, amount and share of the total, and a footer total equal to the Total cost card.
  *Verify:* Page test asserts footer text equals the card text.
- **AC-56 (G5).** Shares and amounts (shall) be computed from unrounded values; the displayed footer total (shall) be the server total, not the sum of rounded entries.
  *Verify:* Unit test of the breakdown helper with values that round unevenly.
- **AC-57 (G5).** ЯКЩО `totals.total_cost_usd` is null, ТОДІ both breakdowns (shall) show "No cost recorded yet." instead of a list.
  *Verify:* Page test.
- **AC-58 (G5).** Every cost amount on the dashboard and on the Stats tab (shall) carry the label "Estimate" (on the card, in the column header and in each breakdown heading), with a legend or tooltip reachable by keyboard explaining: "DevDigest estimate: the provider-reported cost when the provider returns one (OpenRouter), otherwise tokens × the DevDigest price book. Unknown models and failed runs have no cost. No reconciled billing data exists in DevDigest."
  *Verify:* Page test asserts the label in the three places and the legend text via keyboard focus.
- **AC-59 (G5).** No label on either page (shall) call a cost "billed", "actual", "invoiced" or "reconciled".
  *Verify:* Test scanning the feature's message files for these words outside the legend's negative statement.

### States (G7)

- **AC-60 (G7).** ПОКИ the dashboard response is loading (first load or after a period change), the page (shall) show skeleton placeholders for cards, table and breakdowns and no digit, zero, "n/a" or "—" value.
  *Verify:* Page test with a pending query asserts skeleton roles and that no metric text renders.
- **AC-61 (G7).** ЯКЩО the dashboard request fails, ТОДІ the page (shall) show "Could not load agent performance." with a "Retry" button and no metric value.
  *Verify:* Page test with an error response.
- **AC-62 (G7).** КОЛИ the user clicks "Retry", the client (shall) repeat the same GET request with the same period.
  *Verify:* Page test asserts the second request's query.
- **AC-63 (G7).** ЯКЩО the response has `totals.runs = 0`, ТОДІ the page (shall) show an empty state instead of cards, table and breakdowns, with "No agent runs in this period", the applied period, a hint to choose a longer period or run a review, and the excluded-run note of AC-37 when any.
  *Verify:* Page test with a zero-run fixture.
- **AC-64 (G7).** ЯКЩО the workspace has no agents at all, ТОДІ the empty state (shall) say "No agents yet" and link to `/agents`.
  *Verify:* Page test with `agents: []`.
- **AC-65 (G7).** The three per-agent cases "has runs in the period", "no runs in the period but ran before" and "never run" (shall) render differently (AC-50, AC-51), and none of them (shall) look like the empty dashboard.
  *Verify:* Page test with one agent of each kind asserts three distinct Last run texts and no empty-state heading.

### Agent Stats tab (G6, G7)

- **AC-66 (G6).** The agent editor (shall) have a "Stats" tab reachable by the deep link `?tab=stats`.
  *Verify:* AgentEditor test asserts `stats` in the tab keys and the deep link.
- **AC-67 (G6, G2).** КОЛИ the Stats tab opens with `from` and `to` in the URL, it (shall) request `GET /agents/:id/stats` with exactly those values; otherwise it (shall) request the 30 days ending now.
  *Verify:* Tab test for both cases asserts the request query.
- **AC-68 (G6, G2).** The Stats tab (shall) offer the same period options as the dashboard (AC-31..AC-34) and show the applied period.
  *Verify:* Tab test.
- **AC-69 (G6).** The Stats tab (shall) show runs, excluded runs, total cost, avg cost, avg duration, accept rate with "<accepted>/<decisions>" and the low-sample marker, accepted/dismissed/pending counts and last run, using the same formatting as the dashboard.
  *Verify:* Tab test with the fixture used by the dashboard row test; asserts identical texts.
- **AC-70 (G7).** The Stats tab (shall) show skeletons while loading, an error with "Retry" on failure (no metric values), and for 0 counted runs "No runs in this period" (with "Never run" when `last_run_at_all_time` is null).
  *Verify:* Tab test per state.

### Read-only and no model calls (G8)

- **AC-71 (G8).** Both endpoints (shall) accept only GET and (shall) write nothing to the database.
  *Verify:* Integration test compares row counts and `max(updated_at)`-style snapshots of all touched tables before and after calls; route test asserts POST/PUT/DELETE answer 404/405.
- **AC-72 (G8).** Both endpoints (shall) call no LLM provider, embedder, GitHub client or review runner.
  *Verify:* Route test with a container whose LLM provider, embedder, GitHub client and run executor throw on any call.
- **AC-73 (G8).** КОЛИ the user loads, reloads, changes the period, retries, sorts or expands rows on the dashboard or the Stats tab, the client (shall) send only GET requests to `/agent-performance` or `/agents/:id/stats`.
  *Verify:* Page and tab tests with a fetch spy assert method and path of every request.

### Security and rendering (G4, G5)

- **AC-74 (G6).** Both endpoints (shall) aggregate only rows of the caller's workspace.
  *Verify:* Integration test with runs and findings in two workspaces.
- **AC-75 (G4, G5).** Agent names and model strings (shall) be rendered as plain text, never as HTML or markdown.
  *Verify:* Page test with an agent named `<img src=x onerror=alert(1)>` asserts literal text.

### Change boundaries (G9)

- **AC-76 (G9).** The `AgentStats` change (shall) only add fields, be identical in `server/src/vendor/shared/contracts/observability.ts` and `client/src/vendor/shared/contracts/observability.ts`, and keep `server/test/contracts-parity.test.ts` green.
  *Verify:* `pnpm test` in `server/`; diff of the two copies.
- **AC-77 (G1, G9).** The change to `client/src/vendor/ui/nav.ts` (shall) be exactly one added `NAV` item (`key: "agent-performance"`, `href: "/agent-performance"`, an existing icon); no other vendored or shared file (shall) change.
  *Verify:* `git diff --stat main...HEAD -- client/src/vendor server/src/vendor` shows only these files; review of the nav diff.

## Requirements coverage

| Homework requirement (verbatim intent) | Goals | ACs |
|---|---|---|
| Add Agent Performance to the Global sidebar | G1 | AC-30, AC-77 |
| Support 1 day, 30 days and custom range | G2 | AC-4, AC-21..AC-23, AC-31..AC-36 |
| Show Total runs, Total cost, Avg accept rate, Most-active agent | G3 | AC-24..AC-26, AC-29, AC-38..AC-41 |
| Table Agent, Runs, Avg cost, Avg duration, Accept rate, Last run, View | G4 | AC-42..AC-54 |
| Cost breakdown by agents and by models | G5 | AC-27, AC-28, AC-55..AC-57 |
| Same API and aggregation rules as the agent Stats tab | G6 | AC-1..AC-20, AC-66..AC-69 |
| Loading, empty and error states | G7 | AC-60..AC-65, AC-70 |
| No model calls; reads only stored runs and findings | G8 | AC-71..AC-73 |
| Show the accept-rate denominator and the number of runs in the period | G2, G4 | AC-7, AC-37, AC-40, AC-43, AC-69 |
| Sort by accept rate only for agents with enough decisions, or mark small samples | G4 | AC-9, AC-43, AC-48 |
| Acceptance: runs, cost, duration, accept rate match the agent's Stats for the same period | G6 | AC-20, AC-52, AC-67, AC-69 |
| Acceptance: Total cost = sum of counted runs; breakdowns by agent and by model add up to the total | G5 | AC-11, AC-27..AC-29, AC-55, AC-56 |
| Acceptance: Most-active agent is by number of runs in the period | G3 | AC-26, AC-41 |
| Acceptance: an agent without runs and a completely empty dashboard have different correct states | G7 | AC-50, AC-51, AC-63..AC-65 |
| Acceptance: loading and error do not show invented zeros | G7 | AC-8, AC-60, AC-61, AC-70 |
| Acceptance: reloading, sorting, expanding never start a review or model call | G8 | AC-53, AC-72, AC-73 |
| Acceptance: cost metrics make clear what is a DevDigest estimate vs reconciled billing | G5 | AC-16, AC-39, AC-44, AC-58, AC-59 |
| Owner: edit only `AgentStats` (additive, parity green) and one NAV item | G9 | AC-76, AC-77 |

Traceability check: every goal G1..G9 has at least one AC; every AC names a goal.

## Edge cases

- **No agents in the workspace.** Empty state "No agents yet" (AC-64).
- **Agents exist, no counted runs in the period, but failed runs exist.** Empty dashboard plus the excluded-run note (AC-63, AC-37).
- **Agent with only failed runs in the period.** Row shows 0 runs; expanded row shows the excluded count.
- **Agent that has never run.** Row with "Never run" (AC-50); on its Stats tab, "Never run" (AC-70).
- **Run still `running` at load time.** Excluded; after it finishes, a reload counts it. A preset recomputes `now` on reload (AC-35), so numbers can grow between reloads; the View link carries absolute instants, so the dashboard row and the Stats tab compare the same window (AC-52).
- **Decision changed after load** (a finding accepted in another tab). Shown on the next fetch; no live update.
- **Findings decided long after the run.** They count in the period of their run's `ran_at`, not of the decision time (D-9).
- **CI runs.** Counted for runs, cost and duration; they have no persisted findings (SPEC-05 A-7), so they add nothing to decisions. A CI-only agent shows "n/a · 0 decisions".
- **Multi-agent runs.** Each participating agent's `agent_runs` row counts as one run of that agent; the parent multi-agent run is not counted separately.
- **Legacy findings with null scope** (written before scope classification). Rated as in-scope (D-10).
- **Legacy reviews with null `run_id`.** Their findings cannot be tied to a run and are not rated.
- **Cost of 0.** A real 0 cost is a cost (runs_with_cost includes it); only null means "no cost".
- **All counted runs without cost.** Total cost card "No cost recorded"; breakdowns "No cost recorded yet." (AC-39, AC-57); averages "—".
- **Unknown or blank model.** Grouped as `unknown` in the model breakdown (AC-28).
- **Same model written with different spacing or case.** Trimmed; case kept, so `A` and `a` are separate groups (AC-28, D-16).
- **Agent renamed.** The current name is shown for all its runs; names are not stored per run.
- **Agent deleted.** Its runs drop out of every total; `deleted_agent_runs` reports them (AC-3).
- **Two agents with the same name.** Both rows show; ties for most-active resolve by id after name (AC-26).
- **Long agent or model names.** Truncated with an ellipsis and full text in a tooltip/title; no layout break.
- **Large data.** Hundreds of agents are listed without pagination; aggregation is done in the database (NFR).
- **Custom range in the future or far past.** Valid if within 366 days and `from < to`; shows the empty state when no runs.
- **Custom range of one day** (start = end). Requests one full UTC day.
- **Local time zones.** Presets are instant-based; custom dates are UTC days, stated next to the date inputs ("dates are UTC").
- **Concurrent period changes.** Only the response for the latest selected period is shown (older in-flight responses are ignored by the query key).

## Non-functional requirements

- **Performance.** Aggregation runs in a fixed number of SQL queries per request (grouped by agent and by model), never one query per agent. Target: `GET /agent-performance` p95 under 1 s on local Postgres with 50 agents, 20,000 runs and 200,000 findings in the workspace; `GET /agents/:id/stats` under 300 ms for the same data. If an index is needed for `agent_runs (workspace_id, ran_at)`, it goes through a schema change and `pnpm db:generate`.
- **Correctness of money.** Sums use the stored double values; equality checks in tests use a tolerance of 1e-9. Display: amounts ≥ $0.01 with 2 decimals, smaller non-zero amounts with up to 4 significant decimals, never "$0.00" for a non-zero cost.
- **Security.** Workspace scoping on every query (AC-74). Read-only endpoints (AC-71). No secrets, prompts or finding texts in the response. Text rendered as plain text (AC-75).
- **Cost.** No model, embedding or GitHub call (AC-72); the feature costs nothing to use.
- **Observability.** One info log line per request with endpoint, period, agent count, counted runs and duration in ms; no agent names or finding content in logs. Validation failures log at debug.
- **Accessibility.** Cards and table use semantic headings and table markup; sortable headers are buttons with `aria-sort`; expand buttons have `aria-expanded`; "low sample", "Estimate" and status are text, not color only; the cost legend is reachable by keyboard; skeletons have `aria-busy` on the region.
- **Internationalization.** All strings come from next-intl; the dashboard reuses and extends `agentPerformance.*`, the Stats tab reuses and extends `runs.stats.*`; existing keys whose text contradicts this spec (for example `agentPerformance.subtitle`, `sort.cost`) are updated in the same files.
- **Compatibility.** `AgentStats` changes are additive (AC-76); no existing consumer exists, so no migration of clients is needed.

## Inputs and provenance

Verified against this branch with Read/Grep/Glob on 2026-10-18; `get_blast_radius` was not used in this session.

| Input or part | Status in branch | Provenance |
|---|---|---|
| `agent_runs` (workspace_id, agent_id nullable with `set null`, ran_at, provider, model free text, duration_ms, status text, source `local`/`ci`, cost_usd double nullable, tokens_in/out) | exists | `[reused: server/src/db/schema/runs.ts]` |
| `findings` (accepted_at, dismissed_at, scope `in`/`out`/`signal` nullable) and `reviews` (agent_id, run_id without FK) | exists | `[reused: server/src/db/schema/reviews.ts]` |
| Cost semantics: provider-reported OpenRouter cost when available, else price-book estimate; null for unknown models and failed runs | exists | `[reused: reviewer-core OpenRouter cost + server/src/platform/price-book.ts via run-executor]` |
| Reconciled billing data | does not exist | stated as absent (D-15), no input |
| Decision precedence for findings with both timestamps | exists (`decisionOf`, module-private) | `[reused: server/src/modules/evals/service.ts]` rule; `[deterministic: aggregation service]` |
| Scope assignment: every new finding gets a scope; null only on legacy rows | exists | `[reused: reviewer-core/src/review/scope.ts]` |
| `AgentStats` contract (both copies, parity test) | exists, no producer | `[reused: server/src/vendor/shared/contracts/observability.ts, client copy, server/test/contracts-parity.test.ts]` + `[new: additive fields]` |
| Dashboard response contract | missing | `[new: deterministic: agent-performance module schema + client mirror]` (D-2) |
| Aggregation service (counted runs, rates, costs, breakdowns, most-active, trend) | missing | `[new: deterministic: aggregation service]` |
| `GET /agents/:id/stats`, `GET /agent-performance` | missing | `[new: deterministic: server module(s) registered in modules/index.ts]` |
| Nearest existing aggregation over `agent_runs` | `GET /multi-agent/estimates` | `[reused: pattern only]` |
| i18n: `nav.agent-performance` label, `agentPerformance.*`, `runs.stats.*`, `agents` editor tab label "Stats" | exist, unused | `[reused: client/messages/en/shell.json, agentPerformance.json, runs.json, agents.json]` |
| `activeKeyFor('/agent-performance')` | exists | `[reused: client/src/components/app-shell/helpers.ts]` |
| Sidebar `NAV` item | missing | `[new: one item in client/src/vendor/ui/nav.ts]` |
| Icon (`BarChart`) | exists in the icon registry | `[reused: client/src/vendor/ui/icons.tsx]` |
| Agent editor Stats tab | missing (tabs: config, skills, evals, context, ci) | `[new]` |
| Dashboard page `/agent-performance` | missing | `[new]` following the thin `page.tsx` + `_components/<Name>View` pattern |
| LLM calls added by this feature | none | `[deterministic]` everything; 0 LLM calls |

Every number on both pages is computed by code from stored rows. No model summarizes, ranks or explains anything.

## Untrusted inputs

The feature feeds no text to any model, so there is no prompt-injection surface. Text that originates outside the studio and is displayed:

| Input | Origin | Handling |
|---|---|---|
| Agent names | user-entered in the studio | Plain text (AC-75); truncated with full text in a title. |
| Model strings (`agent_runs.model`) | agent config, CI result artifacts (SPEC-05, schema-validated at ingest) | Plain text; used only as a grouping key; never interpreted. |
| Finding titles, bodies, PR titles, repository docs | repository and PR content | Not read or returned by these endpoints; only counts and timestamps of findings are used. |
| `from`/`to` query parameters | URL | Validated as ISO instants with range limits (AC-21) before any query; never concatenated into SQL. |

Should a future version add a model-written summary of this data, the repository- and PR-derived text must be passed as delimited data with the existing injection guard and must not be able to change policy; that is out of scope here.

## Decisions

- **D-1 Contract.** Extend `AgentStats` additively (new fields listed in "Data contracts"); identical in both copies; parity test green. Owner-approved.
- **D-2 Dashboard contract location.** The owner allowed editing only the `AgentStats` contract, so the dashboard envelope is not added to the vendored shared files: it is a Zod schema owned by the server module, mirrored as a client-side type pinned by a client test against a server-produced fixture (the pattern recorded in `client/INSIGHTS.md` for mirrored values). Per-agent entries reuse `AgentStats`. If the owner later counts the envelope as part of "the AgentStats section", it can move into `observability.ts` without behavior change.
- **D-3 Sidebar placement.** `NAV` has no "Global" group; the item is added to the existing app-wide (non-repo-scoped) "SKILLS LAB" group after "Eval Dashboard", `key: "agent-performance"`, `icon: "BarChart"`, no `gKey` and no shortcut-registry change (one item only, as allowed).
- **D-4 Scope of work.** One shared aggregation service, two endpoints (`GET /agents/:id/stats`, `GET /agent-performance`), a minimal Stats tab, the dashboard page. Own implementation.
- **D-5 Counted runs.** `status = 'done'`, `agent_id` not null, both sources; everything else in the period is "excluded" and only counted.
- **D-6 Deleted agents.** Their runs are not counted; their count is reported as `deleted_agent_runs`, so totals are explainable.
- **D-7 Agents listed.** Every agent of the workspace appears in the table (also disabled ones and those with no runs); agents with no runs sort to the bottom under the default sort.
- **D-8 Period parameters.** `from`/`to` ISO instants; presets computed by the client (`to = now`, `from = now − 1d/30d`); custom = two UTC dates, start inclusive, end inclusive as a day (sent as next day 00:00Z exclusive); default 30 days; server rejects `from >= to`, ranges over 366 days, invalid values and a single parameter with 422 `validation_error`; both omitted = last 30 days.
- **D-9 Period axis.** The period applies to `agent_runs.ran_at` only; decisions count with their run regardless of when they were made.
- **D-10 Rated findings.** Scope `in` or null. The owner's default named scope `in`; null is added because null exists only on legacy findings written before scope classification (every new finding gets a scope, including `in` when the scope filter is inactive), and excluding them would turn existing history into "n/a". Out-of-scope and signal findings are hidden from the user's main view and are excluded.
- **D-11 Decision precedence.** Same rule as `decisionOf` (later timestamp wins, tie = accepted), reimplemented or shared without changing the evals module's behavior.
- **D-12 Accept rate.** accepted / (accepted + dismissed); pending excluded; null at 0 decisions; denominator and runs always shown.
- **D-13 Small sample.** < 5 decisions = "low sample"; under accept-rate sorting, agents with ≥ 5 decisions are ranked first, then low-sample agents (by decisions, then name), then n/a agents (by name); low-sample agents are never ranked by their rate.
- **D-14 Averages.** Avg cost over counted runs with a non-null cost (runs without cost counted and shown separately); avg duration over counted runs with a non-null duration; total cost = sum of non-null costs, null when none.
- **D-15 Cost honesty.** Every cost is labelled "Estimate" with a legend explaining provider-reported vs price-book and stating that no billing reconciliation exists; `cost_basis: 'estimate'` in the contract leaves room for a future reconciled basis.
- **D-16 Model grouping.** Trimmed raw `model` string, case-sensitive; null/blank = `unknown`; no alias merging.
- **D-17 Workspace-wide.** No repository, source or model filter.
- **D-18 Last run.** The Last run column uses the last counted run inside the period, so it is consistent with the other columns; the all-time last done run is returned separately and shown only when there is no run in the period ("No runs in period · last <date>") or as "Never run" when there is none.
- **D-19 Most-active.** Max counted runs in the period; ties by name ascending (case-insensitive), then id; none when no runs.
- **D-20 Summary accept rate.** Pooled over all decisions in the period (not a mean of agent rates), so small agents do not dominate; its denominator is shown.
- **D-21 Trend.** The existing required `trend` field is filled with counted runs per UTC day; neither page draws it in this version.
- **D-22 States.** Loading = skeletons, no numbers; error = message + Retry, no numbers; empty dashboard (`totals.runs = 0`) vs agent row with zero runs in the period vs agent that never ran are three distinct renderings; "No agents yet" is a variant of the empty dashboard.
- **D-23 Read-only.** GET only; no writes; no review, model, embedder or GitHub call; expanding a row uses already loaded data only.
- **D-24 URL state.** The dashboard keeps the period choice (`range`, `start`, `end`) in the URL; the View link and the Stats tab use absolute `from`/`to` instants so the cross-check compares the same window.

## Open questions

None blocking. Items the owner may want to confirm at review (each already decided above, so implementation can proceed):

- **OQ-1 (D-10).** Null-scope legacy findings are rated as in-scope. Flip to "scope `in` only" if the owner prefers strictness over coverage of older history; it changes only the rated-finding filter.
- **OQ-2 (D-2).** The dashboard envelope lives in the server module with a client mirror rather than in the shared contracts, to respect "edit only `AgentStats`".
- **OQ-3 (D-3).** The sidebar item sits in the "SKILLS LAB" group because no "Global" group exists.

## Resolutions (coordinator, before planning)

- OQ-1: accepted. Legacy findings with an empty scope are rated as in-scope (D-10).
- OQ-2: accepted. The dashboard envelope stays in the server module with a client mirror; only `AgentStats` changes in the shared contracts.
- OQ-3: accepted. The item goes into the "SKILLS LAB" group after "Eval Dashboard".
