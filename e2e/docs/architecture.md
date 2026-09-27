# e2e architecture — the shared-session runner

`README.md` covers what a flow file looks like and how to run the suite;
this is about `run.ts`'s own execution model, which shapes how you write a
new flow.

## One browser session for the whole suite

`run.ts` discovers every `specs/*.flow.json` (`readdirSync` + `.sort()` —
the `NN-` numeric prefix is what fixes execution order, not a config list),
then runs them **in that sorted order against one shared `agent-browser`
session** (`for (const { file, flow } of flows) { … }`, tearing the session
down once at the very end regardless of pass/fail). A flow that navigates
away and leaves cookies, `localStorage`, or an open modal behind will bleed
into the next flow's starting state — the numeric prefix isn't just cosmetic
ordering, it's load-bearing for any flow that (implicitly) depends on a
prior flow leaving the app on a particular page or logged-in state.

## Implication for writing a new flow

- Always start a new flow with an explicit `open` step to a known URL —
  never assume you're still wherever the previous flow left off, even
  though technically you might be (that coupling is exactly what makes
  flows fragile to reorder).
- A step's non-zero exit fails the **whole run**, not just that flow
  (`run.ts` doesn't isolate failures per file) — so a flakier assertion
  early in the numeric order (e.g. `01-app-boot`) blocks every flow after it
  from even attempting to run, not just from being reported.
- The hermetic runner (`scripts/e2e.sh`) exists specifically because this
  shared-session, ordered-execution model means flows 02/04/05's assumption
  ("the seeded repo is the only one, PR #482 is at a known position") breaks
  silently against a dev DB with extra imported repos — the failure looks
  like a broken flow, but the actual bug is DB state, not the flow itself.
