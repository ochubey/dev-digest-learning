# Workflow retro ledger

One entry per run (appended by `/workflow-retro`): date, feature, totals (tokens, agents, time), top proposals.

## 2026-10-10 — Project Context (SPEC-02), run-plan single-agent, report after each wave

Source: session log and 15 subagent logs (`deep`). Token figures are summed per unique assistant message. **Output tokens of the sonnet subagents are undercounted** (logs keep the first streamed count, e.g. 170 output tokens for an agent that wrote many files), so read them as a lower bound; cache-read figures are reliable. No cost in USD is computed (no price book in the logs). Main-session wall time (9.0 h) includes waiting on the user and is not a work measure.

| Group | Runs | Input | Output | Cache read | Cache write | Tool calls | Wall |
|---|---|---|---|---|---|---|---|
| implementation-planner (opus) | 2 (1 stopped by the user, no result) | 214 | 93.7k | 14.77M | 0.59M | 196 | 16.0 + 15.9 min |
| implementer (sonnet) | 10 | 500 | 5.4k+ | 15.44M | 0.86M | 270 | 40.9 min total |
| plan-verifier (opus) | 1 | 70 | 13.5k | 4.19M | 0.20M | 88 | 4.8 min |
| security / architecture reviewers (sonnet) | 2 | 46 | 14.5k | 1.25M | 0.16M | 94 | 1.2 / 2.0 min (parallel with the verifier) |
| **Subagents total** | **15** | 830 | 127k+ | **35.6M** | 1.8M | 648 | peak 3 in parallel |
| Main session (sonnet) | 240 calls | 480 | 170k+ | **67.2M** | 0.55M | 185 | — |

Order: planner (killed) → planner → implementer P1 → P2+P3a → P4+P3b → P5+P7 → P6a → P6b → P8 → verifier + security + architecture (parallel) → review fixes → widened discovery → skill page. Opus accounts for 19.0M of the 35.6M subagent cache-read tokens (53%).

What was hard / missed:
- The first planner ran 16 min and 9.7M cache-read tokens and returned nothing (stopped by the user); it is read-only, so no partial plan survived. The second planner re-read the same files.
- Every implementer re-read CLAUDE.md, INSIGHTS and the plan (10 launches, about 1.5M cache-read tokens each on the larger ones).
- Gates were incomplete: jsdom/vitest and `tsc` hid a webpack-only failure (runtime import from the shared barrel) and no phase ran `next build`; `pnpm build` then overwrote the user's running dev server's `.next`. `agent-browser` was not installed, so e2e flows first ran at the very end and a flaky step (flow 10) surfaced only then.
- The plan missed the page-level `VALID_TABS` whitelists (Agent and Skill pages), so the new Context tab was unreachable by deep link twice; it also did not ask whether the dev seed touches real workspaces (it attached demo documents to a real repo's agent), and OQ-4 (folder scope) was defaulted without asking the user, then reversed after the lecture was re-read.
- Handoffs: P1 left client typecheck red in a file owned by P7 (fixed in place); wave 2 skipped the red-test step; the AC-20 test passed without testing anything until the verifier caught it. Push failed twice at the end (GitHub email privacy for unpushed commits; `workflow` scope for the CI file).

Top 3 proposals:
1. **Make the client gate part of run-plan:** after any UI phase run typecheck, tests and a build into a separate output directory (add a `distDir` switch to `client/next.config.mjs`), and run the hermetic e2e once per wave; install `agent-browser` and `e2e` deps before the run. Add "tab/route whitelists and seed side effects" to the plan template's checklist.
2. **Cut repeated context:** give implementers a short per-phase brief (files to read, files owned) instead of letting each re-read CLAUDE.md, INSIGHTS and the whole plan, merge tiny phases (P1, P6b cost 0.17M and 0.31M cache-read tokens alone), and ask every subagent for a hand-back of at most 300 words plus a file list — the main session carried 67M cache-read tokens, about 280k per call, mostly from pasted multi-thousand-token reports.
3. **Make the planner loss-proof and time-boxed:** give it a restricted Write tool (only `docs/plans/`) so an interrupted run leaves a draft, cap research (about 40 tool calls) and run it once; keep opus for the planner and try sonnet for `plan-verifier` (it cost 4.2M cache-read tokens) after comparing its findings on the same diff.

## 2026-10-17 — L07 Multi-Agent Review (SPEC-04) and Export to CI (SPEC-05), two worktrees, run-plan multi-agent

Source: both session logs (`58bc891a`, `cbe93bd3`, the second resumes the first) and 31 subagent logs (`deep`). Token figures are summed per unique assistant message and the main-session figure is de-duplicated across the two resumed logs. **Output tokens of subagents are undercounted** (the logs keep the first streamed count: 73 to 1 012 for implementers that wrote many files), so read them as a lower bound; cache-read figures are reliable. No USD cost of the Claude Code work is computed (no price book in the logs). The main session also holds the unrelated Lesson 07/08 reading and the later demo and bug-fix dialogue, so it is an upper bound for this feature.

| Group | Runs | Input | Output | Cache read | Cache write | Tool calls | Wall (agent) |
|---|---|---|---|---|---|---|---|
| spec-creator (opus) | 2 | 120 | 40.1k | 5.10M | 0.32M | 131 | 7.1 + 10.3 min (parallel) |
| implementation-planner (opus) | 2 | 160 | 67.4k | 10.31M | 0.38M | 157 | 7.4 + 12.4 min (parallel) |
| implementer (sonnet) | 17 | 494 | 5.1k+ | 12.57M | 1.01M | 272 | 0.7 to 6.3 min each |
| test-writer role via general-purpose (sonnet) | 4 | 194 | 1.6k+ | 9.89M | 0.56M | 105 | 3.5 to 7.5 min each |
| architecture / security reviewers | 3 | 56 | 18.9k | 1.33M | 0.24M | 88 | 1.0 to 2.3 min |
| plan-verifier (opus) | 3 (1 killed by the usage limit, rerun) | 158 | 31.8k | 8.14M | 0.44M | 168 | 1.5 to 4.4 min |
| **Subagents total** | **31** | 1 182 | 164.9k+ | **47.35M** | 2.95M | 921 | peak 5 in parallel |
| Main session (de-duplicated) | 324 calls | 662 | 209.9k | **99.19M** | 2.03M | — | — |

The main session holds 68% of all cache-read tokens (99.2M of 146.5M).

Product runs (OpenRouter, measured on `devdigest-demo` PR #2, see `docs/retros/l07-multi-agent-1-vs-3.md`): one agent 28.8 s, $0.00019; three agents in parallel 34.9 s, $0.00075 (3.9x cost, 1.2x wall-clock); one CI run $0.0005 in 18.6 s.

Wall-clock: spec to last fix of the first build wave 49 min of agent work (2026-10-11 18:52 to 19:41 UTC). Order: 2 specs (parallel) → 2 planners (parallel) → A: P1 → P2+P3 → P4 → tests (2 parallel) → architecture review + verifier → 1 fix; B: P1 → P2+P3+P4 (parallel) → tests (2 parallel) → architecture + security review → 1 fix → verifier. A usage-limit pause then stopped the work for about 11 h (the second verifier of B ran on 2026-10-12 06:36). Waiting for the human merges and later iterations are not counted; human review time was not measured. A second wave on 2026-10-17 (design gaps, multi-agent CI, bug fixes) launched 7 more implementers over about 43 min (07:06 to 07:49 UTC) and is included in the table above.

Conflicts and re-runs (measured from git): 6 files of 76 (A) and 97 (B) overlap (`client/README.md`, `nav.ts`, `server/README.md`, the migration journal, `modules/index.ts`, `contracts-parity.test.ts`). Rebasing B onto A hit 3 conflict groups (migration journal and snapshot, `modules/index.ts`, `nav.ts`); B's migration was regenerated as `0017` instead of renumbered by hand. After A and the agent-runner PR were merged, PR #23 conflicted once more in 8 `agent-runner` files because B still carried its own copy of the runner commit; a rebase dropped the duplicate. Re-runs: 1 fix pass per feature (2 of the 2 allowed), 1 verifier rerun after the usage limit, 1 fix agent that was cut off and whose work was kept. Tests: server 797 to 1 016, client 583 to 716, agent-runner 23 to 47.

What was hard / missed:
- The lab calls the `ci/` module, the parallel run, the finding grouping and the `multi_agent_runs` link ready infrastructure; none of them existed. Both specs had to build them, so the specs were larger than planned (47 and 91 acceptance criteria).
- The test-writer agent type is not registered in this setup; its role was run through general-purpose. The path-restriction hook of the real test-writer was therefore not exercised.
- The plans were never checked against the browser. Several real defects appeared only in use: the trace drawer listed 0 findings (reviews were fetched once, before the run finished), the grouping merged different issues of one agent, a hung model request left a run in `running` for ever, `POST /ci/sync` returned 500 until the new migration was applied, and the flow "one agent per repository" contradicted what the user expected from multi-agent CI.
- CI was red before this work (e2e install order, two tests that needed a GitHub token), which hid whether our PRs were healthy until PR #24.
- Handoffs: B's implementer for the server module re-read the plan and spec in full (2.1M cache-read tokens); the same verifier ran twice on B.

Top 3 proposals:
1. **Fresh session per wave:** the main session carries 68% of all cache-read tokens because one very long conversation re-reads its whole history on every turn. Start a new chat after the first review wave (hand over the ledger and the plans) and for fix/PR phases.
2. **Freeze the shared registration points before the fan-out:** nav items, `modules/index.ts`, the migration number and the contracts parity test caused every conflict. Let the contracts phase of the first worktree add stub entries for both features, or merge a tiny "scaffold" PR first, so that B never regenerates a migration or resolves `nav.ts`.
3. **Verify in the running app once per feature and cap the verifier:** run the app (or a hermetic browser flow) before the first merge, give the plan-verifier the test counts and the changed-file list instead of letting it re-derive them (8.1M cache-read tokens for 3 runs), and run it once per feature.
