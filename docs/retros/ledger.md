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
