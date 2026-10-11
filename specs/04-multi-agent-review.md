# Spec: Multi-Agent Review
Spec ID: SPEC-04
Status: approved (assumptions A-1..A-15 accepted by default, per the user's "pick the simplest option" instruction)

Revision note: rev 1, first draft for worktree A of the L07 lab (branch `feat/multi-agent-review`). The lab text names the file `specs/multi-agent-review.md`; this repository numbers specs (`specs/README.md`), so the spec lives at `specs/04-multi-agent-review.md`. The caller asked for the simplest viable option for every unknown; each such choice is recorded as an assumption `A-n` in "Open questions" (resolved by default) and the ACs are written against it. Sources: lab requirements "Частина 1" and "Частина 2" (worktree A), design `screen_multiagent.jsx`, `screen_trace.jsx`, `data.jsx` (`PERSONAS`, `PERSONA_CONFLICTS`).

## Problem and user

One PR can carry security risks, performance problems and domain-rule violations at the same time. DevDigest already lets a user run one agent, or "all enabled agents", on a PR, but the results land as separate runs in the PR's run history: nothing ties them together as one review, nothing shows where two agents point at the same code, nothing shows where one agent flagged a line and another stayed silent, and the user cannot pick an arbitrary subset of agents or see what such a run will cost before starting it. Several specialised reviewers give wider coverage only if the product removes duplicates, shows disagreements and does not hide the price.

User: a DevDigest workspace member reviewing a PR who wants two to five specialised agents (for example Security, a stack-specific agent and Conventions) to review the same PR in one go, watch each agent's progress, and then compare the agents' findings side by side.

## Goals / Non-goals

### Goals

- **G1 Launch.** From the PR page or the sidebar, the user opens "Configure run", picks a PR and a set of agents, sees an estimate of time and cost computed from past runs, and starts the run with one button ("Run multi-agent review (N)").
- **G2 One parent run.** One launch creates one `multi_agent_runs` row; every agent's `agent_runs` row belongs to it. The diff and the PR intent are prepared once, the agents run in parallel, and one agent's failure does not cancel or hide the others.
- **G3 Results page.** The user sees the run in two modes: Columns (one column per agent, live status) and Tabs + detail (one agent's full findings with confidence, suggested fix and the existing finding actions).
- **G4 Finding groups without loss.** Findings of different agents about the same code are grouped by a deterministic heuristic (file, line proximity, similarity of substance); every original finding, its text and its author stay available and unchanged.
- **G5 Disagreements.** A "Where agents disagree" block shows, for one code location, each finished agent's position, including "did not flag", with a "Show only conflicts" toggle.
- **G6 Trace reuse.** Each agent column has its own status and a "View trace" link that opens the existing Run Trace drawer (with its Live Log), which explains tokens, cost and the grounding gate result for that agent.
- **G7 Attribution contract and boundaries.** Worktree A defines the finding-attribution contract (finding to agent to run) that worktree B's CI ingest reads; the change stays inside worktree A's areas and merges first.

### Non-goals

- The "1 agent vs 3 agents" cost and time measurement. It belongs to the lab demo (recorded by hand from real runs), not to the product; the product only shows each run's measured numbers.
- A list or history page of past multi-agent runs. A multi-agent run is reached through its URL (the launch navigates there); its child runs also appear in the PR's existing run history. (A-9)
- The "Learn" finding action. `FindingActionKind` contains `learn`, but no route and no button exist today; this feature reuses only existing actions (Accept, Dismiss, Turn into eval case). (A-11)
- Cancelling agents from the multi-agent page. The existing cancel on the PR page keeps working for these runs. (A-12)
- Merging, deduplicating or rewriting stored findings. Groups are computed on read; stored rows are never changed.
- Any new LLM call (no model-written "notes" per agent like the design's "Not a security concern."). (A-7)
- Per-agent model-written disagreement explanations, persona authoring, agent colours and icons beyond what agents already have.
- Changes under `ci/`, `agent-runner/`, the CI Runs page, the agent CI tab, `eval-ci.ts`, or `.github/workflows/`.
- Running more than 5 agents in one multi-agent run. (A-4)
- "fan-out via worktrees" wording from the design's meta row: agents run as parallel in-process contexts, not git worktrees.

## User stories

- **US-1 (G1).** As a reviewer on PR #482, I open "Run review" and choose "Multi-agent review…", land on Configure run with #482 already selected, tick Security, Performance and Conventions, see "≈ 9.1s · $0.18 · parallel", and press "Run multi-agent review (3)".
- **US-2 (G1).** As a reviewer, I open "Multi-Agent Review" from the sidebar, pick a PR from the list, then pick agents.
- **US-3 (G2, G3).** As a reviewer who just started a run, I see three columns; each shows "Running" and switches to "Done" or "Failed" on its own, without a reload.
- **US-4 (G2).** As a reviewer, when the Performance agent fails on a provider error, I still see the Security and Conventions results, and the failed column tells me why.
- **US-5 (G4, G5).** As a reviewer, I see that Security and Conventions both flagged `ratelimit.ts:28`, that Performance did not flag it, and I can still read each agent's own title for that finding.
- **US-6 (G5).** As a reviewer, I switch on "Show only conflicts" to hide locations where all finished agents agree.
- **US-7 (G3).** As a reviewer, I switch to Tabs, open the Security tab, read each finding's confidence and suggested fix, and Accept or Dismiss it, or turn it into an eval case.
- **US-8 (G6).** As a reviewer, I click "View trace" on one column to see that agent's live log while it runs, and later its tokens, cost and grounding result.
- **US-9 (G7).** As the worktree B developer, I read a stable attribution shape (agent id, agent name, run id per finding) that my CI ingest can rely on.

## Acceptance criteria (EARS)

Priorities: P1 blocking, P2 required, P3 wish. Terms:

- **Multi-agent run**: one `multi_agent_runs` row plus its child `agent_runs` rows (linked by `agent_runs.multi_agent_run_id`).
- **Column**: one child agent run as shown on the results page. Its **status** is the child run's status: `running`, `done`, `failed` or `cancelled`. A column is **finished** when its status is `done`; **terminal** when it is `done`, `failed` or `cancelled`.
- **Attributed finding**: a persisted finding plus its attribution `{agent_id, agent_name, run_id}` taken from the review that holds it.
- **Group**: a set of attributed findings of one multi-agent run that the heuristic in AC-27 places together. Every finding of a finished column is in exactly one group (a group may have one member).
- **Take**: one finished column's position on one group: the severity it gave, or "did not flag".

### Launch and Configure run (G1)

- **AC-1 (P1, G1).** The PR page's "Run review" dropdown (shall) offer an item "Multi-agent review…" between "Run all enabled agents" and the per-agent list. КОЛИ the user activates it, the system (shall) open Configure run with the current PR preselected.
  *Verify:* RunReviewDropdown component test asserts the item and the navigation target (`/repos/<repoId>/multi-agent?pr=<number>`).
- **AC-2 (P2, G1).** The sidebar (shall) show a "Multi-Agent Review" item in the WORKSPACE section that opens Configure run for the active repository with no PR preselected.
  *Verify:* nav test (pattern of `nav-evals.test.tsx`) asserts the item, its label and resolved href.
- **AC-3 (P1, G1).** Configure run (shall) show a PR selector listing the active repository's pull requests as "#<number> · <title>", newest first.
  *Verify:* component test with a two-PR fixture asserts both options and their order.
- **AC-4 (P1, G1).** ПОКИ no PR is selected, the system (shall) show the empty state "Pick a pull request first" in place of the agent list and (shall) keep the run button disabled.
  *Verify:* component test without `?pr` asserts the empty state and the disabled button.
- **AC-5 (P1, G1).** ПОКИ a PR is selected, the system (shall) list every agent of the workspace as a checkbox card showing the agent's name, model and its estimate ("≈ <s>s · $<cost>" or "No run history"), with enabled agents preselected, at most the first 5 in list order.
  *Verify:* component test with 6 enabled and 1 disabled agent asserts 7 cards, the first 5 enabled checked, the rest unchecked, and both estimate forms.
- **AC-6 (P2, G1).** The agent step (shall) offer "Select all" (selects up to the first 5 agents) and, when 5 or all agents are selected, "Clear all".
  *Verify:* component test toggles both and asserts the selection.
- **AC-7 (P1, G1).** ЯКЩО 5 agents are selected, ТОДІ the system (shall) disable every unchecked agent checkbox and show the hint "Up to 5 agents per run".
  *Verify:* component test with 5 checked asserts disabled unchecked boxes and the hint.
- **AC-8 (P1, G1).** The run button (shall) read "Select agents" and be disabled with 0 agents selected, "Run 1 agent" with 1, and "Run multi-agent review (N)" with N ≥ 2.
  *Verify:* component test for 0, 1 and 3 selected asserts label and enabled state.
- **AC-9 (P1, G1).** ПОКИ a PR and at least one agent are selected, the system (shall) show the estimate "≈ <T>s · $<C> · parallel", where T is the largest average duration and C the sum of average costs among selected agents that have history; ЯКЩО K selected agents have no history, ТОДІ the system (shall) append " · K without history" and leave them out of T and C.
  *Verify:* helper unit test with three agents (one without history) asserts T, C and the suffix; component test asserts the rendered string.
- **AC-10 (P1, G1).** КОЛИ the client requests `GET /multi-agent/estimates`, the system (shall) return, for every agent of the workspace, `{agent_id, sample_size, avg_duration_ms, avg_cost_usd}` computed by code over that agent's last 10 `agent_runs` with status `done`; `avg_duration_ms` (shall) be null when `sample_size` is 0, and `avg_cost_usd` (shall) be the mean of the non-null costs or null when there are none.
  *Verify:* service unit test with a fixture of 12 done, 2 failed and one null-cost run asserts sample size 10, both averages and that failed runs are ignored; route test asserts workspace scoping.
- **AC-11 (P1, G1).** КОЛИ the user presses the run button, the system (shall) send one `POST /pulls/:id/review` with `{agentIds}` in the displayed card order, show the button as loading and ignore further presses until the request settles, and on success (shall) navigate to the results page of the returned `multi_agent_run_id`.
  *Verify:* component test with a mocked mutation asserts one call with the ids, the loading state, no second call on double click, and the navigation target.
- **AC-12 (P1, G1).** ЯКЩО the launch request fails, ТОДІ the system (shall) show an error toast with the server's message and (shall) stay on Configure run with the PR and agent selection unchanged.
  *Verify:* component test with a rejecting mutation asserts the toast text and the kept selection.
- **AC-13 (P3, G1).** ПОКИ the selected PR is merged or closed, the system (shall) show the existing "merged" warning text next to the run button and (shall) still allow the run.
  *Verify:* component test with a merged PR fixture asserts the warning and the enabled button.

### Server: one parent run, shared preparation, parallel and isolated execution (G2)

- **AC-14 (P1, G2).** The `POST /pulls/:id/review` body (shall) accept an optional `agentIds` array of 1 to 5 distinct strings; ЯКЩО the array is empty, longer than 5 or has duplicates, ТОДІ the system (shall) answer 422 `validation_error`; ЯКЩО `agentIds` is combined with `agentId` or `all`, ТОДІ the system (shall) answer 400 `invalid_run_request`.
  *Verify:* route tests for each invalid body assert the status and code, and that no `agent_runs` or `multi_agent_runs` row exists afterwards.
- **AC-15 (P1, G2).** ЯКЩО any id in `agentIds` is not an agent of the caller's workspace, ТОДІ the system (shall) answer 404 and (shall) create no `multi_agent_runs` and no `agent_runs` row.
  *Verify:* service test with one foreign id asserts 404 and zero new rows.
- **AC-16 (P1, G2).** КОЛИ a valid `agentIds` request arrives, the system (shall) create one `multi_agent_runs` row for the PR and workspace and one `agent_runs` row per agent with `multi_agent_run_id` set to it, and (shall) answer immediately (before any agent finishes) with `{pr_id, runs, reviews: [], multi_agent_run_id}`, `runs` holding one entry per agent.
  *Verify:* service test with a never-resolving mocked LLM asserts the response arrives, one parent row, three linked child rows with status `running`.
- **AC-17 (P1, G2).** КОЛИ a request without `agentIds` arrives (`{agentId}` or `{all:true}`), the system (shall) behave as before this feature: no `multi_agent_runs` row, `multi_agent_run_id` null on its runs, no `multi_agent_run_id` in the response.
  *Verify:* existing review route tests pass unchanged; one added assertion on the null link.
- **AC-18 (P1, G2).** The system (shall) load the PR diff once and derive (or reuse) the PR intent at most once per request, independent of the number of agents.
  *Verify:* executor unit test with 3 agents asserts one diff load and at most one intent derivation call (extends `run-executor.*.test.ts`).
- **AC-19 (P1, G2).** КОЛИ a request targets more than one agent, the system (shall) start every agent's review without waiting for another agent's review to finish.
  *Verify:* executor unit test with a deferred mocked LLM asserts that all 3 LLM calls have started before any is resolved.
- **AC-20 (P1, G2).** ЯКЩО one agent's review fails or is cancelled, ТОДІ the system (shall) still complete and persist the reviews of the other agents, and (shall) record `failed` (with the error text) or `cancelled` on that agent's run only.
  *Verify:* executor unit test where agent 2 of 3 throws asserts agents 1 and 3 are `done` with persisted reviews and agent 2 is `failed` with its error.
- **AC-21 (P2, G2).** ЯКЩО the shared preparation (loading the diff) fails, ТОДІ the system (shall) mark every child run of the request `failed` with the same error (existing behaviour) and the multi-agent run (shall) show all columns failed.
  *Verify:* executor unit test with a failing diff loader asserts all children failed; read-model test asserts all columns `failed`.

### Server: read model, groups and disagreements (G3, G4, G5, G7)

- **AC-22 (P1, G3).** КОЛИ the client requests `GET /multi-agent-runs/:id`, the system (shall) return a `MultiAgentRun` with `id`, `pr_id`, `pr_number`, `ran_at`, `agent_count`, `total_duration_ms`, `total_cost_usd`, `columns`, `groups` and `conflicts`; ЯКЩО the id does not exist in the caller's workspace, ТОДІ the system (shall) answer 404.
  *Verify:* route test for own and foreign workspace; the response parses with the shared `MultiAgentRun` schema.
- **AC-23 (P1, G3).** Each column (shall) carry the child run's `run_id`, `agent_id`, `agent_name`, `provider`, `model`, `status` (`running`, `done`, `failed`, `cancelled`), `error`, `duration_ms`, `cost_usd`, `score`, the review's `verdict` and `summary`, and its findings as attributed findings; columns (shall) be ordered by agent name, then run id.
  *Verify:* service test with one done, one failed and one running child asserts every field and the order.
- **AC-24 (P2, G3).** The system (shall) compute `total_cost_usd` as the sum of the known `cost_usd` of terminal columns (null when none is known) and `total_duration_ms` as the time from the parent's `ran_at` to the latest completion (`ran_at + duration_ms`) among terminal columns (0 when none is terminal).
  *Verify:* service unit test with fixed timestamps asserts both values, including a null-cost column.
- **AC-25 (P1, G7).** Every finding the multi-agent endpoints return (shall) carry `agent_id`, `agent_name` and `run_id` equal to the agent and run of the review that holds it.
  *Verify:* service test with two agents asserts the attribution of each returned finding against the `reviews` rows.
- **AC-26 (P1, G4).** The system (shall) never create, update or delete `findings` or `reviews` rows when computing groups or conflicts.
  *Verify:* service test snapshots `GET /pulls/:id/reviews` before and after `GET /multi-agent-runs/:id` and asserts equality.
- **AC-27 (P1, G4).** The system (shall) group the findings of finished columns with a deterministic heuristic computed by code: two findings are linked when their files are equal, their line ranges overlap or are at most 3 lines apart, and either their categories are equal or the Jaccard similarity of their lower-cased title word sets (words of 3+ letters) is at least 0.5; a group is a connected set of linked findings.
  *Verify:* pure-function unit tests: same file and overlapping lines with equal category group; same lines but different file do not; 4 lines apart do not; different category with similar titles group; transitive chain A-B-C forms one group; output is identical for shuffled input.
- **AC-28 (P1, G4).** Each group (shall) carry `id` (stable for the same input), `file`, `start_line` (smallest member start), `end_line` (largest member end), `title` (the title of the most severe member; ties broken by agent name), and `members`: the attributed findings unchanged, each with its original `id`, `severity`, `title`, `file`, `start_line` and `end_line`.
  *Verify:* unit test with a two-member group asserts every field and that member titles equal the stored titles.
- **AC-29 (P1, G5).** ПОКИ at least two columns are finished, the system (shall) give each group one take per finished column: the most severe member severity of that column with its original title as `note`, or `ignored` with an empty `note` when the column has no member in the group; failed, cancelled and running columns (shall) get no take.
  *Verify:* unit test with 3 done columns and a group flagged by 2 asserts 3 takes, one `ignored`; with one failed column asserts 2 takes.
- **AC-30 (P1, G5).** The system (shall) mark a group `is_conflict` when at least one take is `ignored` or the flagged severities differ, and (shall) return the conflict groups also in `conflicts` (shape `Conflict`: `file`, `line` = group start line, `title`, `takes`).
  *Verify:* unit tests: all flag WARNING, not a conflict; WARNING vs SUGGESTION, conflict; one ignored, conflict; `conflicts` equals the conflict subset.
- **AC-31 (P2, G5).** ПОКИ fewer than two columns are finished, the system (shall) return groups without takes, all with `is_conflict` false, and an empty `conflicts` list.
  *Verify:* unit test with one done and one running column.

### Results page: Columns, Tabs, live status (G3, G6)

- **AC-32 (P1, G3).** The results page (`/repos/<repoId>/multi-agent/<id>`) (shall) show a "Configure run" button, the title "Multi-Agent Review", "<N> agents · parallel", a Columns / Tabs switch, and a meta row with "#<number> <title>", total time and total cost.
  *Verify:* component test with a fixture asserts each element.
- **AC-33 (P1, G3).** КОЛИ the user activates "Configure run" on the results page, the system (shall) open Configure run with the same PR and the same agents preselected.
  *Verify:* component test asserts the target URL carries the PR number and the agent ids.
- **AC-34 (P1, G3).** In Columns mode the system (shall) show one column per agent with: agent name, a status label in text ("Running", "Done", "Failed", "Cancelled"), duration and cost (shown as "—" until terminal), score when done, the agent's findings as compact items (severity, title, `file:line`), and a footer with "View trace" and "<n> findings".
  *Verify:* component test with one column per status asserts the labels, the dash and the footer.
- **AC-35 (P1, G3).** ПОКИ at least one column is `running`, the system (shall) refetch the multi-agent run at most every 4 seconds and (shall) update each column's status and content in place; КОЛИ all columns are terminal, the system (shall) stop refetching.
  *Verify:* hook test with fake timers asserts refetch while a column runs and none after all are terminal.
- **AC-36 (P1, G2).** ПОКИ a column is `failed` or `cancelled`, the system (shall) show its status label and error text in the column body, keep its "View trace" link, and (shall) render the other columns unaffected.
  *Verify:* component test with one failed and two done columns asserts the error text and the two done columns' findings.
- **AC-37 (P2, G4).** ПОКИ a finding belongs to a group with members from other agents, its compact item (shall) show "Also flagged by <agent names>".
  *Verify:* component test with a two-agent group asserts the text on both items.
- **AC-38 (P1, G6).** КОЛИ the user activates "View trace" on a column or an agent tab, the system (shall) open the existing Run Trace drawer for that run, in live-log mode while the run is `running` and in trace mode otherwise (tokens, cost, grounding result).
  *Verify:* component test asserts the drawer opens with that `runId` and the `running` flag matching the column status.
- **AC-39 (P1, G3).** In Tabs mode the system (shall) show one tab per agent (agent name plus score, or status while not done) and, for the selected tab, the agent's summary, score, "View trace", duration and cost, and its findings rendered with the existing finding card (confidence, suggested fix, Accept, Dismiss, Turn into eval case), using the full findings of that run from `GET /pulls/:id/reviews`.
  *Verify:* component test asserts tabs, the header and one finding card with confidence, suggested fix and the three actions.
- **AC-40 (P1, G3).** КОЛИ the user accepts or dismisses a finding in Tabs mode, the system (shall) call the existing `POST /findings/:id/(accept|dismiss)` and show the new state on the card, and the same state (shall) appear on the PR page's Findings tab.
  *Verify:* component test asserts the mutation call and the card state; the PR page reads the same `reviews` query.
- **AC-41 (P2, G3).** The selected mode (shall) live in the URL (`?view=columns|tabs`, default `columns`) so a reload keeps it.
  *Verify:* component test renders with `?view=tabs` and asserts Tabs mode.
- **AC-42 (P1, G3).** ПОКИ the multi-agent run is loading, the system (shall) show a skeleton; ЯКЩО the run is not found, ТОДІ the system (shall) show "Multi-agent run not found" with a link to Configure run; ЯКЩО loading fails otherwise, ТОДІ the system (shall) show an error state with Retry.
  *Verify:* component tests for loading, 404 and 500 fixtures.

### Where agents disagree (G5)

- **AC-43 (P1, G5).** ПОКИ at least two columns are finished, the system (shall) show, below the Columns or Tabs content, a "Where agents disagree" block listing groups, each with `file:line`, the group title and one cell per take: agent name, then the severity in upper case or the muted text "did not flag", then the take's note (the agent's original finding title).
  *Verify:* component test with a conflict fixture asserts one cell per finished agent, the "did not flag" text and the original titles.
- **AC-44 (P1, G5).** The block (shall) have a "Show only conflicts" switch, off by default; ПОКИ it is off the block (shall) list every group that has takes; ПОКИ it is on the block (shall) list only groups with `is_conflict` true.
  *Verify:* component test toggles the switch and asserts the listed groups.
- **AC-45 (P2, G5).** ЯКЩО the switch is on and no group is a conflict, ТОДІ the block (shall) show "No disagreements: all finished agents agree."
  *Verify:* component test with an all-agree fixture.
- **AC-46 (P2, G5).** ПОКИ fewer than two columns are finished, the block (shall) show "Disagreements appear when at least two agents have finished." instead of the list.
  *Verify:* component test with one done and two running columns.

### Shared contracts (G7)

- **AC-47 (P1, G7).** The shared contracts (shall) gain, additively and identically in the server and client vendored copies: `RunRequest.agentIds` (optional), `ReviewRunResponse.multi_agent_run_id` (optional), `FindingAttribution` `{agent_id (nullable), agent_name, run_id}` (and `AgentColumn.agent_id` nullable, for deleted agents), attributed findings in `AgentColumn.findings` (adding `end_line` and the attribution), `AgentColumn.status` value `cancelled` and `AgentColumn.error`, `FindingGroup` and `MultiAgentRun.groups`; no existing field (shall) be removed or narrowed.
  *Verify:* server and client `pnpm typecheck`; a contract unit test parses a sample `MultiAgentRun` and an old-shape `RunRequest`; a parity test asserts the two copies of the changed files are identical.

Traceability: G1 AC-1..13; G2 AC-14..21, AC-36; G3 AC-22..24, AC-32..35, AC-39..42; G4 AC-26..28, AC-37; G5 AC-29..31, AC-43..46; G6 AC-38; G7 AC-25, AC-47 and the "Ownership and merge order" section.

## Edge cases

- **One agent selected.** Allowed ("Run 1 agent"): a multi-agent run with one column; groups have one member each; the disagreement block shows the AC-46 message.
- **Same PR launched twice in parallel.** Each launch is its own multi-agent run; nothing is shared or locked between them (the route's existing rate limit of 10 per minute applies).
- **All agents fail.** All columns show their errors; groups and conflicts are empty; totals cover the failed runs (cost usually null).
- **Agent deleted after the run.** `agent_runs.agent_id` becomes null (existing FK rule); the column shows "Deleted agent" (reviews store no agent name); its findings keep their run attribution.
- **A child run deleted from PR run history.** The column disappears from the multi-agent run; `agent_count` counts remaining children. A parent with no children still opens and shows "No agent runs left in this review."
- **Server restart mid-run.** The existing boot reaper marks running children `failed` ("interrupted"); the page then shows them failed and stops refetching.
- **Agent with zero findings.** Column shows "No findings"; in takes it counts as "did not flag" for every group.
- **Many findings.** Up to 5 agents × any number of findings; columns scroll vertically; the disagreement block lists all groups (no pagination). Grouping is quadratic in findings and runs on read.
- **Finding at the same lines from the same agent twice.** Both stay members of one group; the agent's take uses its most severe member.
- **Ungrounded findings.** Already dropped by the grounding gate before persistence; they never reach groups (their count is visible in the trace).
- **Agent without past runs.** Estimate shows "No run history"; see AC-9.
- **PR without a known number** (`pr_number` null in the contract): the meta row shows the title only.
- **No active repository** when opening from the sidebar: existing repo-not-found state of `/repos/:repoId` routes applies.
- **Very long titles or paths.** Truncated with ellipsis in compact items and cells; full text in the Tabs finding card and in a `title` tooltip.

## Non-functional requirements

- **Performance.** `GET /multi-agent-runs/:id` answers within 300 ms locally for 5 columns × 50 findings; grouping is a pure function without I/O. The results page refetches at most every 4 s and only while a column runs. Launch answers before any agent finishes (AC-16).
- **Cost.** The feature adds no model call: estimates, grouping, takes and conflicts are computed by code. Running N agents costs N agent reviews plus one shared intent derivation (existing).
- **Security.** All new endpoints are workspace-scoped through the existing request context and answer 404 for foreign ids. The launch keeps the existing per-route rate limit. Model output (titles, rationales, suggestions, summaries) is rendered as plain text or through the existing `Markdown` primitive (no raw HTML). No secrets in responses or logs.
- **Reliability.** Per-agent failure isolation (AC-20); concurrent agents may hit provider rate limits, which surface as that agent's failure only.
- **Accessibility.** Agent choices are real checkboxes with labels; the mode switch exposes the selected state (`aria-pressed` or tabs semantics); "Show only conflicts" is a labelled `role="switch"`; status is conveyed in text, never by colour alone; all actions are keyboard reachable.
- **Observability.** The server logs one line per multi-agent launch with `multi_agent_run_id`, `pr_id` and the agent count; every child run keeps its own trace and the shared correlation id already used for one request.
- **i18n.** New UI strings live in a new `client/messages/en/multiAgent.json` namespace (auto-loaded); the one new dropdown item string goes into the existing `prReview` namespace.

## Inputs and provenance

Verified against the worktree code (`/Users/oleksiychubey/dev-digest-wt-multi-agent`), not against the lab's "ready infrastructure" list. The devdigest MCP `get_blast_radius` tool was not available in this session; the checks below are by Read/Grep.

| Input / part | Status | Provenance |
|---|---|---|
| `POST /pulls/:id/review` | exists, but accepts only `{agentId}` or `{all:true}`; no arbitrary agent set, no parent run | [reused: `server/src/modules/reviews/routes.ts`, `RunRequest` in `contracts/platform.ts`] + [new: `agentIds`, parent row, `multi_agent_run_id` in response] |
| Run executor: diff and intent prepared once, per-agent isolation | exists | [reused: `server/src/modules/reviews/run-executor.ts` `executeRuns`] |
| Run executor: parallel agents | missing: agents run one after another (`for ... await runOneAgent`) | [new: concurrent per-agent execution, AC-19] |
| `multi_agent_runs` table | exists as a stub (`id`, `workspace_id`, `pr_id`, `ran_at`), unused by any route | [reused: `server/src/db/schema/runs.ts`] |
| Link from `agent_runs` to `multi_agent_runs` | missing | [new: nullable `agent_runs.multi_agent_run_id`, via schema edit and `pnpm db:generate`] |
| `MultiAgentRun`, `AgentColumn`, `Conflict`, `ConflictTake` contracts | exist, but no route implements them | [reused: `contracts/observability.ts`] + [new: additive fields, AC-47] |
| Multi-agent read endpoint | missing | [new: `GET /multi-agent-runs/:id`, deterministic: multi-agent module] |
| Finding grouping heuristic (file, lines, similarity) | missing: not found in server, reviewer-core or client | [new, deterministic: multi-agent module grouping function, AC-27] |
| Takes, "did not flag", conflicts | missing | [new, deterministic: computed from persisted findings] |
| Past-run estimates | missing (`AgentStats` contract exists, no `/agents/:id/stats` route) | [new, deterministic: `GET /multi-agent/estimates` over `agent_runs`] |
| Per-run status, duration, cost, score, tokens | exists in `agent_runs` | [reused: `agent_runs` columns] |
| Agent verdict, summary, findings | exist in `reviews`, `findings` (`reviews.agent_id`, `reviews.run_id`) | [reused: `GET /pulls/:id/reviews`] |
| SSE with replay buffer | exists | [reused: `server/src/platform/sse.ts`, `GET /runs/:id/events`] |
| `run_traces` and Run Trace drawer with Live Log | exist; drawer embeds `LiveLogStream` and streams SSE while running | [reused: `RunTraceDrawer`, vendored `LiveLogStream`] |
| Finding card actions | Accept, Dismiss, Turn into eval case exist; Learn does not | [reused: `FindingCard`, `POST /findings/:id/(accept|dismiss)`, SPEC-03 eval dialog] |
| Run polling pattern | exists (`refetchInterval` 4 s in `lib/hooks/reviews.ts`) | [reused] |
| `agent_runs.source` (`local`/`ci`) | exists | [reused; this feature writes `local` only] |
| `agent-runner/`, `ci/` module | not present in this worktree | not used by this feature (worktree B) |
| Agent review LLM calls | existing per agent, unchanged prompt path | [reused: reviewer-core via run-executor]; this feature adds 0 LLM calls |

## Untrusted inputs

This feature feeds no new text to a model. The existing per-agent review prompt (diff, PR title and body, project context, skills) is unchanged and keeps its existing delimiting and injection guard; this feature only changes when the agents start (in parallel) and links their runs.

Text derived from untrusted sources that this feature handles as data only:

- Finding titles, rationales, suggestions and review summaries (model output influenced by PR content). Used by the grouping heuristic as plain strings (word sets, equality); rendered as text nodes or through the existing `Markdown` primitive without raw HTML; never interpreted as instructions, URLs to fetch or commands.
- PR titles and numbers shown in the PR selector and meta row: rendered as text.
- File paths in findings: rendered as text and as existing GitHub blob links only.

None of this text can change scoping, the selected agents, the heuristic's thresholds or any policy.

## Open questions

All assumptions below were resolved by default (the caller asked for the simplest viable option); change any of them by revising this spec.

- **A-1 (resolved by default).** The launch reuses `POST /pulls/:id/review` with a new optional `agentIds` field (as the lab asks) instead of a new `/pulls/:id/multi-agent-run` route named in the stub contract's comment.
- **A-2 (resolved by default).** Parallel execution is implemented by starting all per-agent reviews concurrently inside the existing executor. This also makes "Run all enabled agents" parallel. No concurrency cap other than the 5-agent limit.
- **A-3 (resolved by default).** Runs are linked by a nullable `agent_runs.multi_agent_run_id` column (no join table, no stored agent list on the parent).
- **A-4 (resolved by default).** 1 to 5 agents per multi-agent run; enabled agents preselected (first 5); disabled agents can be ticked (matches the existing per-agent run rule).
- **A-5 (resolved by default).** Estimates: mean over the agent's last 10 `done` runs (any source); time estimate = largest mean duration (parallel), cost estimate = sum of mean costs.
- **A-6 (resolved by default).** Grouping thresholds: same file, ranges overlapping or ≤ 3 lines apart, and same category or title Jaccard ≥ 0.5 over words of 3+ letters; transitive. Groups, takes and conflicts are computed on every read, not stored.
- **A-7 (resolved by default).** A take's note is the agent's original finding title; "did not flag" has no note. No model-written notes.
- **A-8 (resolved by default).** "Show only conflicts" off lists every group with takes; on lists only conflicts. The toggle is page state, not persisted.
- **A-9 (resolved by default).** No list of past multi-agent runs; results are reached by URL; child runs stay in the PR run history.
- **A-10 (resolved by default).** Live status in columns comes from polling the aggregate endpoint (≤ 4 s); the per-run live log is available through "View trace" (Run Trace drawer with `LiveLogStream`), not inside the column.
- **A-11 (resolved by default).** "Learn" is not shown in Tabs detail because no Learn action exists; the detail reuses Accept, Dismiss and Turn into eval case only.
- **A-12 (resolved by default).** No cancel control on the multi-agent page.
- **A-13 (resolved by default).** Routes: Configure run at `/repos/<repoId>/multi-agent?pr=<number>&agents=<ids>`, results at `/repos/<repoId>/multi-agent/<id>?view=columns|tabs`; one sidebar item in WORKSPACE.
- **A-14 (resolved by default).** Columns are ordered by agent name (deterministic, no stored order).
- **A-15 (resolved by default).** Validation codes follow the app convention: shape errors from zod answer 422, the `agentIds` + `agentId`/`all` combination answers 400 from the service.

For the researcher (optional, not blocking): measure whether 5 concurrent agent calls on the seeded OpenRouter model hit provider rate limits often enough to need a concurrency cap.

## Ownership and merge order

**Worktree A (this feature) owns these areas** (module level):

- `server/src/modules/multi-agent/` (new module: routes, service, grouping heuristic, estimates, its tests).
- `server/src/modules/reviews/` for this lab: the `agentIds` handling in the review route and service, the parent-run link, and the concurrent per-agent execution in the run executor. Worktree B does not change this module.
- `server/src/db/schema/runs.ts` (the `multi_agent_run_id` column) and the migration that `pnpm db:generate` produces from it.
- `client/src/app/repos/[repoId]/multi-agent/` (new Configure run and results routes).
- `client/src/app/repos/[repoId]/pulls/[number]/` (the PR page: the "Multi-agent review…" dropdown item; Run Trace drawer and finding card are reused, not changed in behaviour).
- `client/src/lib/hooks/` new multi-agent hooks file; `client/messages/en/multiAgent.json`.

**Shared files and who may change them:**

- Finding-attribution contract and multi-agent shapes in `contracts/observability.ts` (`FindingAttribution`, `AgentColumn`, `FindingGroup`, `MultiAgentRun`): owned by worktree A. Worktree B's CI ingest reads `FindingAttribution` (finding to agent to run, via `reviews.agent_id` and `reviews.run_id`) and must not change it; changes go through a revision of this spec.
- `contracts/platform.ts` (`RunRequest`) and `contracts/review-api.ts` (`ReviewRunResponse`): additive edits by worktree A only.
- Each changed contract file exists twice (`server/src/vendor/shared/contracts/` and `client/src/vendor/shared/contracts/`); both copies are edited in lockstep.
- `client/src/vendor/ui/nav.ts` (sidebar): shared with worktree B; A adds exactly one WORKSPACE item. Navigation is re-checked after A's merge.
- `server/src/modules/index.ts` (module registry): shared; A adds one line for the multi-agent module.
- `server/src/db/migrations/**`: generated only. Worktree B, rebasing after A's merge, regenerates its own migration on top of A's instead of renumbering by hand.
- `contracts/eval-ci.ts`, `server/src/db/schema/ci.ts`: owned by worktree B; A does not change them.

**Not touched by worktree A:** `ci/`, `agent-runner/`, the CI Runs page, the agent CI tab, `.github/workflows/`, `reviewer-core/`.

**Merge order:** worktree A merges first (it adds the attribution contract that B's ingest reads). Then worktree B rebases on the new base, resolves only the expected conflicts (`nav.ts`, `modules/index.ts`, migration journal), and repeats its own checks before merging.

**Verification commands (run in this worktree before merge):**

- `server/`: `pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- `client/`: `pnpm typecheck` and `pnpm test`
- Overlap check from the lab: `git diff --name-only` of worktree A and worktree B intersect only in the shared files listed above.
