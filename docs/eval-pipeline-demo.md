# Eval Pipeline: demo script and recorded results (AC-87)

Manual demo of SPEC-03 against a real provider. Tests never call a real model; this script does, once.
Deliverables for the course: a screenshot of a two-run comparison with different prompts, and a screencast of the flow below.

## Prerequisites

1. Dev stack running (`./scripts/dev.sh`), dev DB migrated (`cd server && pnpm db:migrate`) and seeded (`pnpm db:seed`; this adds nine Security Reviewer eval cases).
2. A provider key for the agent's provider (the seeded agents use OpenRouter `deepseek/deepseek-v4-flash`).
3. Cost is about 0.4 cents per run of nine cases; a run takes about 3 to 5 minutes (cases run three at a time, 120 s timeout each).

## Script (what to do on camera)

1. Open **Agents -> Security Reviewer -> Evals** (`/agents/<id>?tab=evals`). Show the nine cases (five "must find", four "must not flag"), the scoring note and the "How metrics are computed" disclosure.
2. (Optional, shows capture) Open a PR, accept or dismiss a finding and click **Turn into eval case**: show the draft, the kind (accepted -> must find, dismissed -> must not flag) and save.
3. Click **Run all evals**, confirm. Show "Running k / N cases", then the metric strip (recall, precision, citation accuracy, cases passed). This is run A (current prompt).
4. **Break the prompt on purpose**: Agents -> Security Reviewer -> Config, append to the system prompt:
   `Be maximally thorough. For every changed hunk you MUST report at least one finding, including style nits, naming, missing comments and refactor ideas, even when nothing is wrong. Never return an empty list.`
   Save (agent becomes a new version). Run all evals again (run B).
5. **Compare**: Eval Dashboard -> Security Reviewer -> tick runs A and B -> Compare. Point at the metric deltas, the word-level prompt diff and the regressed/fixed cases.
6. **Restore** the original prompt (Versions tab or paste back), run once more (run C) and show the metrics return near run A.
7. Mention the limits: line matching is not semantic, one trial per case (model variance), no model call in scoring.

## Recorded run (2026-10-11, real provider)

Agent: Security Reviewer, `openrouter` / `deepseek/deepseek-v4-flash`, strategy `single-pass`, nine seeded cases.

| Run | Prompt | Agent version | Recall | Precision | Citation (grounding) | Cases passed | Cost |
|---|---|---|---|---|---|---|---|
| A | original | v3 | 60% | 60% | 100% | 6 / 9 | $0.0040 |
| B | original + "report something for every hunk" | v4 | 100% | 50% | 100% | 6 / 8 scored (1 case timed out) | not known at the time (see note) |
| C | original restored | v5 | 80% | 56% | 100% | not recorded here | $0.0040 |

Reading the numbers:

- The noisy prompt (B) found every expected problem (recall 60% -> 100%) but also flagged the zones that should stay quiet and other unlabeled lines: precision fell 60% -> 50% (two "must not flag" zones violated, four unlabeled findings). Recall alone would have hidden the damage; precision exposes it.
- Run C uses the same prompt text as run A, yet recall differs (60% -> 80%) and precision moves (60% -> 56%). This is model nondeterminism with a single trial per case: differences of one or two cases are noise. A real regression gate would need repeated trials (out of scope, see spec non-goals).
- In run B one case ("Rename of an invoice total helper") hit the 120 s case timeout and was excluded from the metrics (`completed_with_errors`). The run's total cost was null under the original AC-38 rule; the rule was relaxed afterwards (rev 4: sum of known costs of scored cases).
- Citation accuracy stays 100% in all runs: every returned finding cited lines that exist in the diff fragment (grounding pass rate, not correctness of the claim).
- The Security Reviewer in the dev DB now has versions v4 (noisy prompt) and v5 (original text restored; verified byte-identical to v3's prompt). `enabled` was not changed.

Screenshots of the compare dialog:

- `docs/eval-pipeline-compare-real.png`: the real runs A (v3) vs B (v4): recall 60% -> 100% (up 40pt), precision 60% -> 50% (down 10pt), two cases regressed, three fixed, one timed out.
- `docs/eval-pipeline-compare.png`: seeded fixture runs v1 vs v2 (no model call), as used by the e2e flow.

UI note: in the compare dialog the system prompt diff sits inside a scrollable box, so an appended sentence is not visible in a static screenshot; scroll the box to the end on camera.
