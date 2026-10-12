# How eval metrics are computed

An eval run reviews every eval case of an agent once and scores the findings it
returns. Scoring is plain code (`server/src/modules/evals/scoring.ts`,
`matching.ts`): no model is called to judge anything, and the same stored findings
always give the same numbers.

## Cases and expectations

A case is a diff fragment plus one expectation: a file and an inclusive line range,
with a kind.

- `must_find`: the agent should report a problem on these lines (made from an
  accepted finding).
- `must_not_flag`: the agent should stay silent on these lines (made from a
  dismissed finding).

The expectation is never sent to the model.

## Matching

A grounded finding matches an expectation when it is in the same file (exact,
case-sensitive; one leading `./` is ignored) and its line range overlaps the
expected range (inclusive). Only the findings produced for a case are compared with
that case's expectation.

"Grounded" means the finding survived the grounding gate, which drops findings that
cite lines not present in the diff. Dropped findings are counted separately.

## Choosing expectation ranges

The match is strict: same file and overlapping line ranges, nothing fuzzy. Models often
cite a neighbouring line (the context line above, the closing brace below) even when they
found the right defect. A one-line expectation then turns a correct finding into
`unlabeled`, which lowers precision and makes the baseline look flaky. So label the whole
changed region, not one line: from the first added or removed line to the last one of the
hunk, plus one context line on each side, never outside the fragment. For a `must_not_flag`
case use the whole benign change as the zone, so a noisy agent is still penalised by
`fp_zone`. The seeded cases follow this rule (checked by `eval-seed-fixture.test.ts`).

## Per-finding labels and per-case result

| Case kind | Finding matches | Label |
|-----------|-----------------|-------|
| `must_find` | yes | `tp` (true positive) |
| `must_not_flag` | yes | `fp_zone` (false positive in a protected zone) |
| either | no | `fp_unlabeled` (false positive outside any labelled range) |

A `must_find` case passes with at least one match. A `must_not_flag` case passes with
no match. A case that errored (provider error, timeout) has no result and is left out
of every metric below.

## The three metrics

- **recall** = `must_find` cases with at least one match / `must_find` cases scored.
  A case counts once, however many findings hit it. `null` when no `must_find` case
  was scored.
- **precision** = `tp / (tp + fp_zone + fp_unlabeled)`. This is strict: every grounded
  finding is in the denominator, so a finding that matches no labelled range counts
  against the agent. `null` when the run has no grounded findings.
- **citation_accuracy** = `grounded / (grounded + dropped)`. `null` when the run
  produced no findings at all.

A `null` metric means "not measurable for this run", not zero. A run of only
`must_not_flag` cases has `recall = null`; a run where the model returns nothing has
`precision = null` and `citation_accuracy = null`.

### Why citation_accuracy is a "grounding pass rate"

The grounding gate checks only that a finding cites lines that exist in the diff the
model was given. A finding can cite real lines and still be wrong, and a dropped one
may have been right about the wrong line number. So the metric measures how often the
agent's citations are valid, not whether its findings are correct. It is labelled
"grounding pass rate" in the UI for that reason; correctness is what recall and
precision approximate.

## Worked example

Case A is `must_find`; the agent returns three grounded findings: two overlap the
expected lines, one is elsewhere in the fragment. Case B is `must_not_flag`; it returns
two grounded findings: one inside the protected lines, one elsewhere.

| | Findings | tp | fp_zone | fp_unlabeled |
|---|----------|----|---------|--------------|
| Case A | match, match, unlabeled | 2 | 0 | 1 |
| Case B | in zone, unlabeled | 0 | 1 | 1 |
| Total | 5 | 2 | 1 | 2 |

- precision = 2 / (2 + 1 + 2) = 2/5 = **0.4**.
- recall = 1 / 1 = 1.0 (case A is hit once, although two findings match it).
- Case B fails (a finding landed in its zone); case A passes.
- If the gate also dropped 1 finding, citation_accuracy = 5 / (5 + 1) = about 0.83.

## Stored counts

Each run stores the counts the metrics come from (`cases_scored`, `cases_passed`,
`must_find_total`, `must_find_hit`, `must_not_flag_total`, `must_not_flag_violated`,
`tp`, `fp_zone`, `fp_unlabeled`, `grounded`, `dropped`, `cases_errored`), so any metric
can be recomputed from them and two runs can be compared without re-reading findings.

## Limits

- Matching is mechanical, not semantic. A finding on the right lines for the wrong
  reason counts as a match; a correct finding on lines shifted away from the labelled
  range can miss.
- Strict precision treats any finding outside a labelled range as a false positive,
  including a real problem nobody labelled. That keeps a prompt that flags everything
  from looking good, but it also penalises genuine extra catches.
- Fragments are small and case sets are small, so one case moves recall by a large
  step. The model is nondeterministic: run-to-run differences with the same agent can
  be noise.
- Costs and token counts are reported per case and per run but do not enter the
  metrics. A run's total cost is the sum of the known costs of its scored cases;
  errored cases are ignored, and the total is null only when no scored case has a
  known cost.
