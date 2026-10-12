# Spec: flow execution contract

The `*.flow.json` files ARE the specs (`README.md` has the per-file coverage
table) — this doc is the contract for the thing that isn't in any single
JSON file: what must stay true about how they run **together**, per
`docs/architecture.md`'s shared-session model.

## Invariants

1. **Numeric order is the execution order.** `run.ts` sorts filenames, not a
   declared dependency list — renumbering `04-pr-findings.flow.json` to run
   before `01-app-boot.flow.json` (e.g. by renaming it `00-...`) changes
   what state it starts from, even though its own steps are unchanged.
2. **A flow may NOT assume it's the first thing to run**, except
   `01-app-boot` itself — every other flow starts with an explicit `open`
   step to a known URL rather than relying on wherever the previous flow's
   last step left the browser.
3. **Flows 02/04/05/08/10 assume the seeded repo (`acme/payments-api`, PR #482) is
   the only repo in the DB** — this is a real, documented precondition
   (`README.md`'s precondition callout), not an accident. Adding a repo via
   the UI (as a manual test, or a prior flow) and then running these flows
   against that same DB will make them land on the wrong repo and fail in a
   way that looks like a broken flow rather than stale DB state. The
   hermetic runner (`scripts/e2e.sh`) exists precisely to guarantee this
   precondition on every run.
4. **One step's failure stops the whole suite**, not just its own flow file
   — there's no per-flow isolation/continue-on-failure. A flow added at
   position `03` that's flaky blocks `04`-`08` from running at all, not just
   from being reported as failed.
5. **No flow may trigger a real LLM call** — the suite exists specifically
   as the read-only, key-free counterpart to the LLM-backed review flow; a
   new flow that clicks "Run Review" against a real agent would silently
   turn a deterministic, free CI job into a flaky, billed one. `08-pr-brief`
   only asserts the empty PR Brief card (the seed stores no brief) and never
   clicks "Generate brief", which would call the model.
6. **Flows 09 and 10 depend on seeded project-context data.** 09 needs the API
   to run with `PROJECT_DOCS_SOURCE=fixture` (the 4 documents of
   `server/src/db/fixtures/project-docs.ts`) and the seeded Security Reviewer
   with 2 attached paths; 10 opens the seeded run whose id is
   `SEED_PROJECT_CONTEXT_RUN_ID` in `server/src/db/seed.ts`. Neither clicks
   attach/detach or runs a review, so they stay read-only.
7. **Flow 11 depends on the seeded `breaking-change-detector` skill** (created
   by `server/src/db/seed.ts`). It only navigates and reads (no attach, no
   model call).
