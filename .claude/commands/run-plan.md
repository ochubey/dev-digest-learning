---
description: Execute an approved plan phase by phase (implementer -> test-writer -> architecture-reviewer -> fixes -> plan-verifier)
argument-hint: <plan path, e.g. docs/plans/pr-brief.md> [phase ids] [--no-tests]
---

# run-plan

Plan: $ARGUMENTS

Spec and plan are written and approved before this runs; they are not part of this command.

## Steps

1. Read the plan and its spec (`specs/`). Stop if spec status is not `approved` or the plan has an AC with no task.
2. Baseline: run `pnpm typecheck` and unit tests in each touched package; record pre-existing failures.
3. Per phase, in plan order (parallel only if the plan says multi-agent AND the phases are independent):
   - `implementer` with plan path, phase id, baseline. Tests it runs: only those touched by the phase plus typecheck.
   - `test-writer` with the spec ACs of the phase (not the code), unless `--no-tests`.
   - Re-run the phase checks yourself, show real output.
   - Tick the phase in the plan.
4. After all phases: `architecture-reviewer` on the diff. Then up to 2 fix iterations: pass `implementer` exactly the findings to fix (list them), re-run checks, re-review only if something structural changed.
5. `plan-verifier` with spec path + plan path. Show the PASS/PARTIAL/MISSING matrix unaltered; gaps go back to `implementer` (one more iteration) or are reported.
6. Never commit, branch, or push unless asked. Offer a commit per stage (spec, plan, code, tests) so history shows intent first.
7. Finish with the matrix AC -> task -> test and the list of deviations. Suggest `/workflow-retro`.
