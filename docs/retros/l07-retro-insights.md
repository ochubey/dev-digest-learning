# L07 retro: what the insights mean, what to do, and a theoretical token estimate

Companion to the L07 entry in `docs/retros/ledger.md`. All figures come from the session and subagent logs summed per unique message (see the ledger for the method and its limits). **Output tokens of subagents are undercounted** (the log keeps the first streamed count), so everything below is about cache-read tokens, which are reliable and are the dominant volume. No USD figures: the logs contain no price list, and this setup's model prices were not available. A formula for turning the token numbers into dollars is at the end.

## Measured baseline

| | Cache-read tokens | Share |
|---|---|---|
| Main (orchestrating) session, 324 model calls | 99.19M (about 306k per call) | 68% |
| 31 subagents | 47.35M | 32% |
| Total | 146.54M | 100% |

Within the subagents: implementers 12.57M, planners 10.31M, test-writers 9.89M, plan-verifiers 8.14M (3 runs), spec-creators 5.10M, reviewers 1.33M.

## The three proposals, explained

### 1. Fresh session per wave (the big one)

**What it means.** Every model call re-reads the whole conversation as cache-read tokens. One conversation that lives through specs, plans, implementation, review, fixes, PRs and demo fixes grows to hundreds of thousands of tokens of context, and each of its 324 calls pays for all of it. Starting a new chat after each wave and handing over only a short summary stops that growth.

**What to do concretely.**
- Wave boundaries: after the specs and plans are written; after both features pass their gates; after the review/verify/fix loop; before the PR and demo phase.
- At each boundary write a handover of about 40k tokens at most: the spec and plan paths, branch names, gate results, open issues. The files already exist (`specs/`, `docs/plans/`, the ledger), so the handover is mostly links.
- Keep subagent prompts as they are: they already start cold.

**Would it be effective?** Yes, it is the only proposal that moves the total noticeably, and it is cheap to apply. It costs a little re-orientation per new session and loses chat-only context (decisions not written into a file), which is why decisions must go into the spec or ledger.

### 2. Freeze the shared registration points before the fan-out

**What it means.** Every conflict came from the same few files that both worktrees must touch: the sidebar (`nav.ts`), the module registry (`modules/index.ts`), the migration number and journal, and a contracts-parity test. Adding stub entries for both features in one small first step (or one scaffold PR) removes the conflicts and the migration renumbering.

**What to do concretely.** Add both nav items, both module registrations and the contract test entries (empty or placeholder) in the contracts phase of the first worktree; reserve the migration order (A takes `0016`, B takes `0017`) in the specs; B then never regenerates a migration or edits `nav.ts`.

**Would it be effective?** For tokens, little (about 2 to 3% of the total, see below). Its value is mostly time and risk: no rebase conflict handling, no regenerated migration. It also makes the "two worktrees barely overlap" check pass cleanly (6 shared files in this run).

### 3. Verify in the running app once per feature and cap the plan-verifier

**What it means.** Two separate points. (a) The plan-verifier ran three times (one run was cut off by the usage limit and repeated) and each run re-derived what the tests and diff already say, about 8.1M cache-read tokens in total. Give it the changed-file list and the test counts, and run it once per feature. (b) None of the automated checks opened the app; five real defects were found by looking at it (trace drawer showing 0 findings, same-agent findings merged into one group, a hung model request leaving a run `running` for ever, a 500 from `/ci/sync` before the new migration was applied, and the "one agent per repository" limit). A short browser pass before the first merge would have caught them earlier.

**What to do concretely.** Hand the verifier the diff stat and test counts; run one hermetic browser flow or a manual checklist per feature before merging; put "applied the new migration" into the checklist.

**Would it be effective?** Modest for tokens (2 to 4%), high for quality: it is the only proposal that targets the defects that actually reached the user.

## Theoretical token saving if the main recommendations were applied

This is a model, not a measurement. Assumptions are written next to each line so they can be challenged.

| Proposal | Assumption | Cache-read tokens saved | Share of 146.54M |
|---|---|---|---|
| 1. Fresh session per wave | the main session made 324 calls at about 306k average context; with 4 sessions and a 40k hand-over, context grows from 40k to about 150k inside each wave, so the average is 90k to 130k per call, giving 29M to 42M instead of 99.2M | 57M to 70M | 39% to 48% |
| 2. Freeze shared points | about 12 main-session calls were spent on conflicts, migration regeneration and the duplicated runner commit; at about 306k each, avoided | about 3.7M | about 2.5% |
| 3. Verifier once with a prepared summary | drop the repeated B run (4.17M) and trim the remaining two runs by about 40% (about 1.2M) | about 5.4M | about 3.7% |
| **Total** | | **about 66M to 79M** | **about 45% to 54%** |

Reading the table:
- Proposal 1 is about nine tenths of the saving. The estimate is sensitive to how fast the context really grows; the 90k to 130k average is the main assumption.
- The saving is in cache-read tokens. Cache reads are the cheapest token class, so the saving in dollars is smaller than the 45% to 54% share of tokens. The real dollar figure needs prices (below).
- Output tokens and cache-write tokens are not modelled; the logs undercount output, and fresh sessions would add a small cache-write cost for the hand-over.

## Turning the tokens into dollars

For each token class multiply by the price of the model that produced it:

`cost = input x p_in + output x p_out + cache_read x p_cache_read + cache_write x p_cache_write`

The needed inputs are the per-million-token prices for the models used here (opus for specs, planners and verifiers; sonnet for implementers, test-writers, reviewers and the main session) and the billed figures from the provider dashboard, which are more reliable than the log sums because they include the undercounted output. With those, the table above converts directly: apply `p_cache_read` to the saved volumes.
