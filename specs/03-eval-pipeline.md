# Spec: Eval Pipeline
Spec ID: SPEC-03
Status: approved

Revision note: rev 4 — AC-38 cost rule relaxed after a real run: a single timed-out case made the total cost null, so the total is now the sum of known costs of scored cases (errored cases ignored); verifier gaps AC-59/61 (overview ignores failed runs), AC-65 (run detail from the Evals tab) and AC-87 (demo script, docs/eval-pipeline-demo.md) addressed. Rev 3 — priority cut (AC-45, AC-47, AC-57, AC-62, AC-63, AC-71, AC-72, AC-84, AC-85 demoted to P3: implement only after all P1/P2 are green), added AC-87 (real-model demo script) and AC-88 (run isolation), decisions D-11 (workflow files are a hard stop) and D-12 (cost comparison is by repeated runs of one agent with a changed model). Rev 2 — OQ-1..OQ-4 answered by the user (recommended defaults accepted): OQ-1 strict precision, OQ-2 additive edits to both vendored `eval-ci.ts` copies plus a new run table via `pnpm db:generate`, OQ-3 minimal private root `package.json` calling `scripts/verify-l06.sh` (no `--with-integration` flag), OQ-4 edit `client/src/vendor/ui/nav.ts`. Rev 1: first draft. Branch `l06-evals-ci`, stacked on PR #18 (SPEC-02 Project Context). The user's requirements (homework L06, see `docs/plans/l06-evals-ci.md` section 2) are recorded as decisions D-1..D-10. Items marked `[NEEDS CLARIFICATION: OQ-n]` carry a recommended default; the ACs are written against that default and change if the answer differs. The homework text names the file `specs/eval-pipeline.md`; this repository numbers specs (`specs/README.md`), so the spec lives at `specs/03-eval-pipeline.md` (OQ-17).

## Problem and user

A DevDigest review agent is configured by a system prompt, a model, a strategy and linked skills. When a user edits any of these, nothing tells them whether the agent got better or worse: today the only signal is reading new review output by hand on a new PR. A prompt tweak that silently stops catching a real bug, or starts flagging code the team already judged harmless, is invisible until it hurts.

The team already produces the ground truth needed to detect that: every finding a reviewer accepts is evidence of a real problem at a known file and line range, and every finding a reviewer dismisses marks a zone where the agent should stay quiet. The `eval_cases` and `eval_runs` tables and the `EvalCase` / `EvalRun` / `EvalRunRecord` / `EvalDashboard` contracts exist but are empty and unused.

User: a DevDigest workspace member who authors review agents (prompt, model, skills) and wants regression protection: they turn real accepted or dismissed findings into eval cases, run the agent on the whole case set after a change, read recall, precision and citation accuracy, and compare the new run with an old one side by side.

The Eval Pipeline lets that user (1) turn a finding into an eval case in one click and review it before saving, (2) see an agent's case set, (3) run the agent on all cases with fixed, stored inputs and a recorded agent version manifest, (4) see metrics computed by code with zero model calls, and (5) browse run history and compare two runs ("old prompt vs new").

## Goals / Non-goals

### Goals

- **G1 Capture.** From a finding card the user creates an eval case in one click: the system drafts it from the finding (diff fragment, file, line range, expectation from accept/dismiss), the user reviews and saves it.
- **G2 Case set.** In the Agent editor's Evals tab the user sees every case of the agent with its kind, location, origin and last result, and can delete a case.
- **G3 Execution.** The user runs the agent on all its cases (`POST /agents/:id/eval-runs`). Each case is reviewed from its stored inputs only, so runs of different agent versions see identical inputs; each run records the agent version and a manifest of the configuration used.
- **G4 Deterministic scoring.** Recall, precision and citation accuracy (grounding pass rate) and per-case pass/fail are computed by code from the case expectations and the run's findings, with a fixed, documented formula and zero LLM calls.
- **G5 Metrics and history.** The user sees the latest metrics with deltas in the Evals tab, and every agent's latest run plus a per-agent run table on a separate Eval Dashboard page.
- **G6 Compare.** The user selects two runs of an agent and sees them side by side: metric deltas, cost, the system prompt diff between the two versions, and which cases changed result.
- **G7 Evidence and verification.** The demo agent has a seeded set of at least 8 cases covering both expectation kinds; `pnpm verify:l06` checks the pipeline without network or model keys and exits non-zero on any failure; a deterministic test proves that a prompt change moves the metrics through the pipeline.
- **G8 Safety and robustness.** Case and run data are workspace-scoped; repository content inside cases is untrusted data; provider failures, partial runs, concurrency and empty sets have explicit, non-destructive behavior.

### Non-goals

- Manual Case Editor (creating or editing a case from scratch, the "New eval case" button, the `ScreenEvalCase` design). Cases come only from findings (G1) and the seed (G7). (D-9)
- Editing a saved case (name, expectation, range). Delete and recreate instead. `[NEEDS CLARIFICATION: OQ-12]`
- Trend charts, sparklines, the "30 days" filter and the regression alert banner text from the design. (D-9)
- "Promote vN" in the compare view; any action that changes the agent from the eval UI.
- "Run all agents" on the dashboard and running a single case. `[NEEDS CLARIFICATION: OQ-13]`
- Replaying a past agent version (running version N when the agent is at version M). Runs always use the agent's current version. `[NEEDS CLARIFICATION: OQ-5]`
- Skill evals (`owner_kind = 'skill'`, the Skill editor Evals tab). (D-9)
- The lab `evals/` harness package, LLM-judge graders, Claude Agent SDK sessions, harness CI wiring, Export to CI, hooks, mutation testing. (D-9)
- Semantic matching of findings (title, category, severity, rationale). Matching is file plus line-range overlap only (D-4).
- Repeated trials, variance or confidence intervals per run.
- Eval runs appearing in the PR timeline, the Runs list, the Run Trace drawer or the PR's findings. Eval runs never create `agent_runs`, `reviews` or `findings` rows.
- Repo-intel context, project context (SPEC-02), memory, PR intent and PR description in eval prompts (they are not part of a case's fixed inputs, D-6). `[NEEDS CLARIFICATION: OQ-6]`
- Any change under `.github/workflows/` (D-11), including a new CI workflow for `verify:l06`. `[NEEDS CLARIFICATION: OQ-15]`

## User stories

- **US-1 (G1).** As a reviewer reading an accepted finding, I click "Turn into eval case", see a draft with the diff fragment, file, lines and the expectation "must find", adjust the name if I want, and save, so this bug becomes a regression check for the agent.
- **US-2 (G1).** As a reviewer who dismissed a finding as a false positive, I turn it into a "must not flag" case; if I dismissed it for another reason (duplicate, out of scope), I can change the expectation or cancel before saving.
- **US-3 (G2).** As an agent author, I open the agent's Evals tab and see all its cases, which kind each is, where it came from, and whether it passed in the last run.
- **US-4 (G3, G5).** As an agent author who just edited the system prompt, I click "Run all evals", see progress, and then see the new recall, precision and citation accuracy with deltas against the previous run.
- **US-5 (G5).** As an agent author, I open the Eval Dashboard from the left sidebar and see every agent's latest eval run, then open one agent's run history.
- **US-6 (G6).** As an agent author, I select two runs and compare them: which metrics moved, how cost changed, what changed in the system prompt, and which cases flipped from pass to fail or back.
- **US-7 (G4).** As an agent author, I trust the numbers because I can read how they are computed and know no model graded my model.
- **US-8 (G7).** As a course reviewer, I run `pnpm verify:l06` and get a green or red answer without Docker, network or API keys.

## Acceptance criteria (EARS)

Each AC carries its priority (P1 blocking, P2 required, P3 wish) and its goal. Terms used throughout:

- **Case**: a row in `eval_cases` with `owner_kind = 'agent'`. Its **expectation** is `{kind, file, start_line, end_line}` where `kind` is `must_find` or `must_not_flag`. Its **fixed inputs** are the stored diff fragment and the stored metadata defined in AC-12.
- **Eval run**: one execution of an agent over all its cases at one agent version. A run has one **case result** per case.
- **Grounded findings** of a case result: the findings the review engine kept after the grounding gate for that case's diff fragment. **Dropped findings**: those the gate removed.
- **Match**: a finding matches a case when its file equals the case's file and its line range overlaps the case's line range (AC-24).

### Capture: turn a finding into a case (G1)

- **AC-1 (P1, G1).** ПОКИ a finding card is expanded and the finding is accepted or dismissed, the system (shall) show a "Turn into eval case" action next to Accept and Dismiss.
  *Verify:* FindingCard component test with an accepted and a dismissed fixture asserts the action is present and enabled.
- **AC-2 (P2, G1).** ПОКИ a finding is neither accepted nor dismissed, the system (shall) show the "Turn into eval case" action disabled with the text hint "Accept or dismiss the finding first".
  *Verify:* component test with an undecided fixture asserts the disabled state and the hint.
- **AC-3 (P1, G1).** КОЛИ the user activates "Turn into eval case", the system (shall) open a review dialog prefilled with a draft case and (shall) not store anything until the user saves.
  *Verify:* component test asserts the dialog opens and no create request is sent; route test asserts the draft endpoint writes no row.
- **AC-4 (P1, G1).** The system (shall) set the draft expectation kind to `must_find` for an accepted finding and to `must_not_flag` for a dismissed finding, and the draft file and line range to the finding's `file`, `start_line` and `end_line` (D-2).
  *Verify:* service unit test for both statuses asserts kind, file and range.
- **AC-5 (P1, G1).** The system (shall) build the draft diff fragment from the PR's diff as: the file header of the finding's file and every hunk of that file whose new-side lines intersect the finding's range, each hunk kept whole with its original `@@` header, so that new-side line numbers in the fragment equal those in the PR. `[NEEDS CLARIFICATION: OQ-7 — fragment size]`
  *Verify:* service unit test with a two-hunk file and a finding in the second hunk asserts exactly that hunk with its original header; parsing the fragment yields the same new-side numbers.
- **AC-6 (P1, G1).** The review dialog (shall) show: an editable name (default: the finding title slugified, at most 80 characters), the expectation kind as an editable choice of "Must find" and "Must not flag", the file and line range (read-only), the diff fragment (read-only, monospaced), the owner agent, and an optional notes field.
  *Verify:* component test asserts each field and that the kind can be switched.
- **AC-7 (P2, G1).** ПОКИ the drafted kind is `must_not_flag`, the dialog (shall) show the hint "Dismissed is not always 'no problem'. Save as Must not flag only if the agent should stay silent here."
  *Verify:* component test with a dismissed fixture.
- **AC-8 (P1, G1).** КОЛИ the user saves the dialog, the system (shall) create one case owned by the agent that produced the finding's review, with the reviewed name, kind, file, range, fragment and notes, record the source finding, PR and the finding's accept/dismiss status as case metadata, close the dialog and confirm with "Eval case saved" and a link to the agent's Evals tab.
  *Verify:* component test asserts the create payload and the confirmation; integration test asserts the stored row and its metadata.
- **AC-9 (P1, G1).** ЯКЩО the finding's review has no agent (seeded or legacy review, or the agent was deleted), ТОДІ the dialog (shall) require the user to pick an agent of the workspace before Save is enabled.
  *Verify:* component test with `agent_id = null` asserts Save is disabled until an agent is chosen.
- **AC-10 (P2, G1).** ЯКЩО a case created from the same finding already exists for the same agent, ТОДІ the system (shall) show "Already an eval case" with a link to it instead of the save action, and the create endpoint (shall) answer 409 without writing.
  *Verify:* component test with an existing-case fixture; route test asserts 409 and an unchanged row count.
- **AC-11 (P1, G1).** ЯКЩО no hunk of the PR's current diff intersects the finding's range (the PR moved on or the file left the diff), ТОДІ the system (shall) refuse the draft with the message "The finding's lines are no longer in the PR diff" and create nothing.
  *Verify:* service unit test with a non-intersecting range asserts the error and no write.
- **AC-12 (P1, G1, G3).** The system (shall) store in each case everything an eval run needs as fixed inputs: the diff fragment, the expectation, and the file path; and it (shall) not depend at run time on the source PR, finding, review or repository still existing.
  *Verify:* integration test deletes the source PR after creating a case and asserts an eval run still executes that case.
- **AC-13 (P2, G1).** ЯКЩО saving the case fails, ТОДІ the dialog (shall) stay open with the user's edits and show an error message.
  *Verify:* component test with a failing mutation.
- **AC-14 (P2, G1).** The system (shall) validate a case on create: non-empty name, kind in `must_find | must_not_flag`, `start_line ≥ 1`, `end_line ≥ start_line`, a non-empty fragment that parses as a unified diff containing the case's file, and a range that intersects a hunk of that file; otherwise it (shall) answer 400 and write nothing.
  *Verify:* route test per invalid case.

### Case set (G2)

- **AC-15 (P1, G2).** The system (shall) add an "Evals" tab to the Agent editor, reachable by `?tab=evals`.
  *Verify:* component test renders the tab; page test with `?tab=evals` opens it.
- **AC-16 (P1, G2).** The Evals tab (shall) list every case of the agent, one row each, showing: the last result icon with a text label (`pass`, `fail`, `error`, `never run`), the name, a kind badge with the text "must find" or "must not flag", the origin ("from accepted finding", "from dismissed finding", or "seeded"), `file:start–end`, and the last result detail (for example "expected ≥1 matching finding, got 0").
  *Verify:* component test with a mixed fixture asserts each element per row.
- **AC-17 (P2, G2).** The system (shall) order cases by kind (`must_find` first), then by name ascending.
  *Verify:* component test asserts the order.
- **AC-18 (P1, G2).** The Evals tab header (shall) show the badges "X / Y passing" (X = cases passed in the latest completed run, Y = cases scored in it) and "N cases" (current case count).
  *Verify:* component test with 9 cases and a latest run of 8 scored, 6 passed asserts "6 / 8 passing" and "9 cases".
- **AC-19 (P1, G2).** ЯКЩО the agent has no cases, ТОДІ the system (shall) show the empty state "No eval cases yet" with the hint "Open a PR review, accept or dismiss a finding, then use Turn into eval case." and (shall) disable "Run all evals".
  *Verify:* component test with an empty list.
- **AC-20 (P2, G2).** КОЛИ the user deletes a case and confirms, the system (shall) remove the case; past runs (shall) keep their recorded results and metrics for that case.
  *Verify:* component test asserts the confirm step and the request; integration test asserts the run's stored case results are unchanged.
- **AC-21 (P2, G2).** ПОКИ the case list is loading, the system (shall) show a loading placeholder; ЯКЩО loading fails, ТОДІ it (shall) show an error with Retry.
  *Verify:* component test for pending and failed queries.
- **AC-22 (P2, G2).** КОЛИ an agent is deleted, the system (shall) delete its cases and eval runs.
  *Verify:* integration test asserts no case or run rows remain for the deleted agent.

### Scoring (G4)

All scoring is a pure function of the case expectations and each case result's grounded and dropped findings. Case results with status `error` are excluded from every count below.

- **AC-23 (P1, G4).** The system (shall) compute every metric and every case pass/fail by code, making zero LLM or provider calls, and the scoring code (shall) import no LLM provider, model client or prompt module (D-3).
  *Verify:* unit test scores a fixture run with a spy provider and asserts zero calls; a static test parses the scoring module's import graph and fails on any import of `reviewer-core/src/llm`, `server/src/adapters/llm` or provider SDK packages; `verify:l06` runs both.
- **AC-24 (P1, G4).** The system (shall) treat a finding `f` as matching a case `c` exactly when `f.file` equals `c.file` (exact, case-sensitive string comparison after removing a leading `./`) and the inclusive ranges overlap: `max(f.start, c.start) ≤ min(f.end, c.end)`, each range first normalized so that start ≤ end (D-4).
  *Verify:* table-driven unit test: touching ranges (10–12 vs 12–15) match; adjacent (10–11 vs 12–15) do not; reversed range matches; same lines in another file do not; `./src/a.ts` vs `src/a.ts` match; `src/A.ts` vs `src/a.ts` do not.
- **AC-25 (P1, G4).** The system (shall) mark a `must_find` case as passed when at least one of its grounded findings matches it, and a `must_not_flag` case as passed when none of its grounded findings matches it.
  *Verify:* unit test per kind with zero, one and two matching findings.
- **AC-26 (P1, G4).** The system (shall) compute **recall** = (number of `must_find` cases with at least one matching grounded finding) / (number of `must_find` cases), and (shall) report it as null when the run has no scored `must_find` case.
  *Verify:* unit test: 4 `must_find` cases, 3 hit → 0.75; a `must_find` case with two matching findings counts once; zero `must_find` cases → null.
- **AC-27 (P1, G4).** The system (shall) compute **precision** = TP / (TP + FP_zone + FP_unlabeled) over all grounded findings of the run, where TP = grounded findings that match their own `must_find` case, FP_zone = grounded findings that match their own `must_not_flag` case, FP_unlabeled = grounded findings that match no labeled range of their case; and (shall) report it as null when the run has zero grounded findings. Findings outside any labeled range therefore count as false positives (strict precision).
  *Verify:* unit test: case A `must_find` with findings {match, match, unlabeled}, case B `must_not_flag` with findings {in zone, unlabeled} → TP 2, FP_zone 1, FP_unlabeled 2, precision 2/5 = 0.4; a run with no grounded findings → null.
- **AC-28 (P1, G4).** The system (shall) compute **citation_accuracy** = (grounded findings) / (grounded + dropped findings) over the run, documented and labeled in the UI tooltip as "grounding pass rate", and (shall) report it as null when the run produced no findings at all (D-5).
  *Verify:* unit test: 6 kept, 2 dropped → 0.75; 0 and 0 → null; component test asserts the tooltip text.
- **AC-29 (P1, G4).** The system (shall) store with each run, next to the three metrics, the counts they come from: cases scored, cases passed, `must_find` total and hit, `must_not_flag` total and violated, TP, FP_zone, FP_unlabeled, grounded, dropped, and cases errored.
  *Verify:* integration test asserts the stored counts for a fixture run; unit test asserts each metric is recomputable from the counts.
- **AC-30 (P1, G4).** The system (shall) score each case only against the findings produced for that case (findings of one case never match another case's expectation).
  *Verify:* unit test with two cases on the same file and overlapping ranges, findings only in case A's result, asserts case B is not hit.
- **AC-31 (P2, G4).** The Evals tab and the dashboard (shall) show the scoring note "Scoring is mechanical: a finding counts when the file matches and line ranges overlap. No model call in the scorer." and a "How metrics are computed" disclosure that states the three formulas in words and the limits: line matching is not semantic (a finding on the right lines for the wrong reason counts as a match), and a finding on shifted lines next to the real problem can miss.
  *Verify:* component test asserts the note and the disclosure text.

### Execution (G3)

- **AC-32 (P1, G3).** КОЛИ a client sends `POST /agents/:id/eval-runs` for an agent with at least one case and no running eval run, the system (shall) create an eval run in status `running` with one pending case result per current case, answer 202 with the run id, and execute the cases in the background.
  *Verify:* route test asserts 202, the run row and N pending case results; the response arrives before any provider call completes (stub provider with a delay).
- **AC-33 (P1, G3).** The system (shall) record on the run, at creation: the agent id, the agent's current `version`, and a manifest equal to the agent's version snapshot (`AgentVersionConfig`: provider, model, system prompt, output schema, strategy, gate, repo_intel flag, ordered skill ids) plus the id and version of each enabled linked skill whose body is used; later edits to the agent or its skills (shall) not change a running or finished run (D-6).
  *Verify:* integration test edits the agent's prompt while a stubbed run is in progress and asserts every case was reviewed with the original prompt and the stored manifest is unchanged.
- **AC-34 (P1, G3).** The system (shall) review each case with the shared review engine using only: the manifest's system prompt, model, provider and strategy, the bodies of the recorded skills, and the case's stored diff fragment, with a fixed task line that names no PR, repository or author; it (shall) pass no PR description, intent, repo-intel context, project context or memory (D-6). `[NEEDS CLARIFICATION: OQ-6]`
  *Verify:* unit test with a recording fake provider asserts the assembled messages contain the fragment and the prompt and none of those sections; snapshot of the messages for a fixture case.
- **AC-35 (P1, G3).** The system (shall) never place a case's expectation, name, notes, origin or source finding text in the prompt sent to the model.
  *Verify:* unit test with sentinel strings in name, notes and expectation asserts none appears in the recorded messages.
- **AC-36 (P1, G3).** Two runs of the same case set (shall) send byte-identical diff and task content to the model; only the agent-derived parts (system prompt, skills, model, strategy) may differ.
  *Verify:* unit test runs the same case set with two manifests and asserts the user-message content is identical.
- **AC-37 (P1, G3).** The system (shall) store per case result: status (`ok` or `error`), the grounded findings (file, lines, severity, category, title), the dropped findings with their grounding reason, the pass/fail result (null on error), duration, tokens in and out, cost, and an error message on error.
  *Verify:* integration test with a stub provider asserts the stored case results.
- **AC-38 (P1, G3).** КОЛИ every case result is final, the system (shall) score the run (AC-23..AC-30), store the metrics, total duration and total cost (the sum of the known costs of scored cases; errored cases are ignored; null only when no scored case has a known cost), and set the run status to `completed` (no case errored), `completed_with_errors` (some errored) or `failed` (all errored).
  *Verify:* run tests for each of the three outcomes.
- **AC-39 (P1, G3).** ЯКЩО reviewing one case fails (provider error, timeout, unparsable output after the engine's retries), ТОДІ the system (shall) mark that case result `error` with a sanitized message, continue with the other cases, and exclude it from the metrics (AC-38).
  *Verify:* run test with a stub that throws for one of three cases asserts two scored, one error, status `completed_with_errors`.
- **AC-40 (P1, G3).** The system (shall) execute cases with bounded concurrency (at most 3 at a time) and a per-case timeout (120 s), and (shall) mark a timed-out case `error` with "timeout". `[NEEDS CLARIFICATION: OQ-8]`
  *Verify:* run test with a stub that records concurrent calls asserts the maximum; fake timers assert the timeout.
- **AC-41 (P1, G3).** ЯКЩО an eval run for the same agent is already `running`, ТОДІ `POST /agents/:id/eval-runs` (shall) answer 409 with the running run's id and start nothing.
  *Verify:* route test with a running run.
- **AC-42 (P1, G3).** ЯКЩО the agent has no cases, ТОДІ `POST /agents/:id/eval-runs` (shall) answer 400 "No eval cases for this agent" and create nothing.
  *Verify:* route test.
- **AC-43 (P1, G3).** ЯКЩО the agent's provider has no API key configured, ТОДІ `POST /agents/:id/eval-runs` (shall) answer with the same error status and message as starting a PR review with that agent, and create nothing.
  *Verify:* route test with no key asserts the status, message and zero rows.
- **AC-44 (P2, G3).** ЯКЩО the agent has more than 50 cases, ТОДІ `POST /agents/:id/eval-runs` (shall) answer 400 naming the limit and create nothing. `[NEEDS CLARIFICATION: OQ-8]`
  *Verify:* route test with 51 cases.
- **AC-45 (P3, G3).** The system (shall) apply a per-route rate limit to `POST /agents/:id/eval-runs` like other model-calling endpoints.
  *Verify:* route test with the limiter enabled asserts 429 past the cap.
- **AC-46 (P1, G3).** The system (shall) create no `agent_runs`, `run_traces`, `reviews` or `findings` rows for an eval run.
  *Verify:* integration test counts those tables before and after a run.
- **AC-47 (P3, G3).** КОЛИ the server starts and finds eval runs still `running` from a previous process, the system (shall) set them to `failed` with the reason "interrupted", keeping the case results already finished.
  *Verify:* integration test inserts a running run, boots the app, asserts the status and kept results.
- **AC-48 (P2, G3).** The system (shall) write one log line per eval run at start (agent, version, case count, model) and at end (status, metrics, duration, cost), and one line per errored case with its case id and sanitized reason; it (shall) never log diff fragments or model output.
  *Verify:* run test captures log lines and asserts no sentinel fragment text.
- **AC-88 (P1, G3, G8).** The system (shall) review every case in its own stateless model call that has no tools, no file or network access and no conversation history, and (shall) not give a call access to any other case, to any earlier or concurrent run, to stored results, expectations or metrics; the model and provider are exactly those of the run's manifest, so a run of another model is an independent run of the same cases.
  *Verify:* unit test with a recording fake provider asserts every call has an empty tool list and a single fresh message list built only from AC-34 inputs, and that no call from run B contains any text from run A's stored results (sentinel strings in stored results and expectations).

### Evals tab: run and metrics (G3, G5)

- **AC-49 (P1, G3, G5).** The Evals tab (shall) show a "Run all evals" action; КОЛИ the user activates it, the system (shall) start an eval run (AC-32) for the agent's current version.
  *Verify:* component test asserts one POST.
- **AC-50 (P1, G5).** ПОКИ an eval run of the agent is `running`, the Evals tab (shall) show "Running k / N cases" updated at least every 3 seconds, disable "Run all evals", and on completion refresh the metric strip, the case results and the run history without a page reload.
  *Verify:* component test with a mocked polling sequence asserts the progress text, the disabled action and the refreshed strip.
- **AC-51 (P1, G5).** The Evals tab (shall) show a metric strip with Recall, Precision, Citation accuracy and "Cases passed" of the latest finished run (`completed` or `completed_with_errors`), metrics as whole percentages and "Cases passed" as `X/Y`, each metric with its delta in percentage points against the agent's previous finished run, shown with ▲ or ▼ and the number (not color only).
  *Verify:* component test with two runs (recall 0.75 → 0.88) asserts "88%" and "▲ 13pt"; a decrease asserts "▼".
- **AC-52 (P1, G5).** ЯКЩО a metric is null, ТОДІ the system (shall) show "—" with a tooltip giving the reason ("no must-find cases", "no findings returned", "no findings produced"), and no delta for it.
  *Verify:* component test with null metrics.
- **AC-53 (P2, G5).** ЯКЩО the agent has cases but no finished run, ТОДІ the metric strip (shall) show "No eval runs yet" and every case row `never run`.
  *Verify:* component test.
- **AC-54 (P2, G5).** ЯКЩО the latest finished run used an older agent version than the current one, ТОДІ the metric strip (shall) show "Metrics are from vN; the agent is now vM. Run all evals to update."
  *Verify:* component test with run version 3 and agent version 4.
- **AC-55 (P2, G5).** The Evals tab (shall) show the agent's last 10 eval runs (ran at, version, status, recall, precision, citation, cases passed, cost) and a "View full dashboard" link to the agent's page on the Eval Dashboard.
  *Verify:* component test with 12 runs asserts 10 rows and the link target.
- **AC-56 (P2, G5).** ЯКЩО starting a run fails (409, 400, missing key, network), ТОДІ the Evals tab (shall) show the server's message and re-enable the action (for 409 it (shall) instead show the running run's progress).
  *Verify:* component test per error.
- **AC-57 (P3, G3, G5).** The Evals tab (shall) show before starting a run a confirm step "Run N cases with <model>? Each case makes one review call to the model." with Run and Cancel.
  *Verify:* component test asserts the text and that Cancel sends nothing.

### Eval Dashboard (G5)

- **AC-58 (P1, G5).** The system (shall) add an "Eval Dashboard" entry to the left sidebar under Skills Lab that opens the dashboard page.
  *Verify:* component test of the sidebar asserts the entry and its link; e2e asserts navigation.
- **AC-59 (P1, G5).** The dashboard landing (shall) list every agent of the workspace with its name, model, the latest finished run's version, time and "X/Y pass", and its Recall, Precision and Citation as whole percentages, or "No eval runs yet".
  *Verify:* component test with one agent with runs and one without.
- **AC-60 (P2, G5).** The dashboard landing (shall) list the 6 most recent eval runs across agents (agent name, ran at, version, three metrics, X/Y pass, status); КОЛИ the user activates an agent or a run row, the system (shall) open that agent's dashboard page.
  *Verify:* component test asserts 6 rows, order by time descending, and the navigation.
- **AC-61 (P1, G5).** The agent's dashboard page (shall) show the agent name and model, three metric cards (latest finished run, with deltas against the previous finished run as in AC-51), a "Run eval" action (AC-49, AC-50, AC-57 behavior), and a runs table with: a selection checkbox, ran at, version, status, recall, precision, citation, cases passed, cost.
  *Verify:* component test asserts the elements.
- **AC-62 (P3, G5).** The runs table (shall) list the agent's runs newest first, 20 per page with "Load more".
  *Verify:* component test with 25 runs.
- **AC-63 (P3, G5).** The agent's dashboard page (shall) offer an agent switcher and a "All agents" control that returns to the landing; the page URL (shall) identify the agent so it can be linked.
  *Verify:* component test; page test with the agent id in the URL.
- **AC-64 (P2, G5).** ЯКЩО the workspace has no agents, ТОДІ the landing (shall) show "No agents yet" with a link to Agents; ПОКИ data loads, it (shall) show a placeholder; ЯКЩО loading fails, ТОДІ it (shall) show an error with Retry.
  *Verify:* component tests for each state.
- **AC-65 (P2, G5).** КОЛИ the user opens a run (from the table or the Evals tab history), the system (shall) show the run's per-case results: case name, kind, pass/fail/error, matched and unlabeled findings with `file:lines`, dropped findings with their grounding reason, and the error message for errored cases. `[NEEDS CLARIFICATION: OQ-14]`
  *Verify:* component test with a fixture run.

### Compare (G6)

- **AC-66 (P1, G6).** ПОКИ exactly two runs of the agent are selected, the "Compare" action (shall) be enabled; otherwise disabled with the hint "Select two runs to compare"; selecting a third run (shall) replace the earlier-selected one.
  *Verify:* component test selects 1, 2 and 3 runs.
- **AC-67 (P1, G6).** КОЛИ the user activates Compare, the system (shall) open a compare view titled "Compare runs · vA → vB" that places the older run (by run time) as A on the left and the newer as B on the right.
  *Verify:* component test selecting the newer run first asserts the order.
- **AC-68 (P1, G6).** The compare view (shall) show for Recall, Precision, Citation accuracy and Cost the value of A, the value of B and the delta (percentage points for metrics, dollars for cost) with ▲ or ▼ text, and "—" for null values.
  *Verify:* component test with fixture values asserts each cell.
- **AC-69 (P1, G6).** The compare view (shall) show a word-level diff of the two runs' recorded system prompts (from their manifests), marking removed and added text with both color and strikethrough/underline, and "System prompt unchanged" when equal; it (shall) also list other manifest differences (model, strategy, skills added or removed, skill version changes).
  *Verify:* component test with two manifests differing in one sentence and the model asserts the marked tokens and the model line.
- **AC-70 (P1, G6).** The compare view (shall) list the cases whose result differs between A and B (pass → fail, fail → pass, scored → error), grouped as "Regressed", "Fixed" and "Errored", and the count of unchanged cases.
  *Verify:* component test with a fixture of 8 cases, 1 regressed and 2 fixed.
- **AC-71 (P3, G6).** ЯКЩО the two runs scored different case sets (cases added or deleted between them), ТОДІ the compare view (shall) show "Case sets differ: N only in A, M only in B. Metrics are not directly comparable." and list those cases separately.
  *Verify:* component test with differing sets.
- **AC-72 (P3, G6).** The compare view (shall) be a labeled dialog that closes on Escape and on its close control and returns focus to the Compare action.
  *Verify:* component test; manual keyboard check.

### Seed, experiment and verification (G7)

- **AC-73 (P1, G7).** The seed (shall) create at least 8 cases for the seeded Security Reviewer agent, at least 3 of kind `must_find` and at least 3 of kind `must_not_flag`, each with a self-contained diff fragment whose expectation range intersects a hunk of its file; cases derived from seeded demo findings (shall) be marked with their origin and the remainder marked "seeded". `[NEEDS CLARIFICATION: OQ-9]`
  *Verify:* unit test over the seed fixture data asserts the counts, kinds and range/hunk intersection; integration test asserts the rows after `pnpm db:seed`.
- **AC-74 (P1, G7).** The seed (shall) be idempotent for eval cases: re-running it (shall) not duplicate cases. `[NEEDS CLARIFICATION: OQ-10 — re-create cases the user deleted?]`
  *Verify:* integration test seeds twice and asserts the case count.
- **AC-75 (P1, G7).** A deterministic test (shall) run the pipeline on the seeded case set twice with a fake provider whose output depends on the system prompt (a "good" prompt returns findings on the `must_find` ranges; a "broken" prompt returns findings on every changed line including the `must_not_flag` zones) and (shall) assert that precision of the broken-prompt run is lower than that of the good-prompt run and that recall differs between a prompt that finds nothing and the good prompt.
  *Verify:* the test itself, included in `verify:l06`.
- **AC-76 (P1, G7).** `pnpm verify:l06`, run from the repository root, (shall) run in order: typecheck and unit tests of `server` (excluding `*.it.test.ts`), `client` and `reviewer-core`; the seed fixture test (AC-73); the scorer purity tests (AC-23); and the experiment test (AC-75); and (shall) exit non-zero on the first failing step, naming it.
  *Verify:* run it green; break one assertion and confirm a non-zero exit and the named step.
- **AC-77 (P1, G7).** `pnpm verify:l06` (shall) need no Docker, network access, database or model API key.
  *Verify:* run with networking disabled and no keys in the environment.
- **AC-78 (P2, G7).** The seed (shall) create two finished eval runs of the Security Reviewer at two versions with different system prompts and fixed, deterministic case results, only when the e2e fixture mode is on (same switch as the SPEC-02 demo context), so the dashboard and compare view can be shown without a model call. `[NEEDS CLARIFICATION: OQ-11]`
  *Verify:* integration test with the fixture switch on and off.
- **AC-87 (P1, G7).** The repository (shall) document a manual demo script in `docs/plans/eval-pipeline.md` or the feature docs: run the seeded set with the current prompt, change the system prompt, run again, compare (metrics move), break the prompt on purpose, run again (precision drops), compare; and list the course deliverables (screenshot of a two-run comparison, screencast).
  *Verify:* the document exists and the steps were executed once against a real provider before submission; results are not asserted by automated tests.

### Access and contracts (G8)

- **AC-79 (P1, G8).** ЯКЩО the caller is not a member of the workspace that owns the agent, case, run or finding, ТОДІ every eval endpoint (shall) answer 404 without revealing whether the id exists, and (shall) read or write nothing else.
  *Verify:* route tests per endpoint with another workspace's ids.
- **AC-80 (P1, G8).** The system (shall) answer 404 for an unknown agent, case, run or finding id, and validate path ids as UUIDs.
  *Verify:* route tests.
- **AC-81 (P1, G8).** The API (shall) expose: case draft from a finding, case create, case list per agent, case delete, eval run start, eval run list per agent (paged), eval run detail with case results, the workspace latest-run overview, and the comparison data for two runs of the same agent (409 or 400 when the two runs belong to different agents).
  *Verify:* route tests per endpoint against the contract schemas.
- **AC-82 (P1, G8).** Contract changes (shall) be additive: existing `EvalCase`, `EvalCaseInput`, `EvalRun`, `EvalRunRecord` and `EvalDashboard` consumers (shall) keep parsing; any change to `vendor/shared` (shall) be identical in the server and client copies.
  *Verify:* diff check of the two vendored copies; contract tests parse old and new fixtures.
- **AC-83 (P2, G8).** UI text derived from cases and findings (names, file paths, titles, fragments, error messages) (shall) be rendered as plain text, never as HTML or markdown with raw HTML.
  *Verify:* component test with `<img onerror>` in a case name and fragment asserts no such element.

### End-to-end (deterministic, no LLM)

- **AC-84 (P3, G2, G5).** An e2e flow (shall) open the seeded Security Reviewer's Evals tab and assert at least 8 case rows, both kind badges, and the metric strip of the seeded latest run.
  *Verify:* new flow under `e2e/specs/`, read-only, fixture mode.
- **AC-85 (P3, G5, G6).** An e2e flow (shall) open the Eval Dashboard from the sidebar, open the Security Reviewer, select the two seeded runs, open Compare and assert the metric deltas and a marked prompt difference, without starting a run.
  *Verify:* new flow under `e2e/specs/`.
- **AC-86 (P3, G1).** An e2e flow (shall) open the "Turn into eval case" dialog on a seeded decided finding, assert the prefilled kind, file and lines, and cancel without saving. `[NEEDS CLARIFICATION: OQ-11]`
  *Verify:* new flow under `e2e/specs/`.

## Edge cases

| Case | Expected behavior | AC |
|---|---|---|
| Finding not yet accepted or dismissed | Action disabled with a hint. | AC-2 |
| Dismissed for a reason other than "false positive" | User switches the kind or cancels in the review dialog. | AC-6, AC-7 |
| Finding re-decided after the case was saved (accept → dismiss) | The case keeps its saved kind; no automatic update. | AC-8 |
| Same finding turned into a case twice | "Already an eval case"; 409. | AC-10 |
| Review without an agent (seeded, legacy, deleted agent) | User picks the owner agent. | AC-9 |
| PR updated after the review, finding lines no longer in the diff | Draft refused with a message. | AC-11 |
| Finding spans two hunks | Both hunks are in the fragment. | AC-5 |
| Very large hunk | Kept whole up to the fragment cap. | AC-5, OQ-7 |
| Source PR, review or finding deleted later | The case still runs (self-contained). | AC-12 |
| Agent with zero cases | Empty state; Run disabled; POST 400. | AC-19, AC-42 |
| Agent with only `must_not_flag` cases | Recall null ("no must-find cases"); precision from any returned findings. | AC-26, AC-52 |
| Model returns no findings at all | Precision and citation null; `must_find` cases fail, `must_not_flag` pass. | AC-25..AC-28 |
| Model flags every changed line | Precision drops through FP_zone and FP_unlabeled; recall may rise. | AC-27, AC-75 |
| Finding cites lines outside the fragment | Dropped by grounding; lowers citation accuracy; never counts for recall or precision. | AC-28 |
| Correct problem, shifted line numbers | May miss: documented limit. | AC-31 |
| Right lines, wrong reason | Counts as a match: documented limit. | AC-31 |
| Several findings on one `must_find` case | Case counts once for recall; each finding is a TP for precision. | AC-26, AC-27 |
| One case errors (provider, timeout, bad output) | Case `error`, excluded from metrics, run `completed_with_errors`. | AC-39 |
| All cases error | Run `failed`, no metrics. | AC-38 |
| No API key for the agent's provider | Start refused with the review error; nothing created. | AC-43 |
| Run started twice / two tabs | Second start 409 with the running id. | AC-41 |
| Agent edited during a run | Run uses the snapshot taken at start. | AC-33 |
| Skill body edited between runs | Recorded skill versions differ; compare shows it. | AC-33, AC-69 |
| Server restarts mid-run | Run `failed` "interrupted", finished results kept. | AC-47 |
| Case deleted after runs | Past runs keep its results; compare flags differing case sets. | AC-20, AC-71 |
| Cases added between two runs | Compare shows "Case sets differ". | AC-71 |
| More than 50 cases | Start refused naming the limit. | AC-44 |
| Agent deleted | Its cases and runs are deleted. | AC-22 |
| Same file path, different repositories across cases | Each case is scored only against its own findings. | AC-30 |
| Hostile text in fragment, file name or case name | Data in the prompt, plain text in the UI. | AC-35, AC-83 |
| Model nondeterminism | Same inputs can give different results; temperature stays at the provider default 0; no repeats in scope. | Non-goals |

## Non-functional requirements

- **Determinism and cost.** Scoring makes zero model calls (AC-23). Each case makes exactly the review engine's calls for one review of its fragment (normally one; map-reduce only if the agent's strategy and the fragment demand it). The confirm step shows case count and model before spending (AC-57). Total and per-case cost are stored and shown (AC-37, AC-38).
- **Performance.** Starting a run answers within 500 ms (202) regardless of case count. With concurrency 3 and typical single-hunk fragments, a 10-case run targets ≤ 2 minutes on the seeded default model. Run list and overview endpoints answer within 300 ms p95 for up to 500 runs per workspace. `[NEEDS CLARIFICATION: targets accepted?]`
- **Security.** All endpoints are workspace-scoped (AC-79). Fragments, file names and case names are untrusted (see below). Expectations never reach the model (AC-35). UI renders case data as text (AC-83). Logs never contain fragments or model output (AC-48). No secret appears in stored run manifests (the manifest holds provider and model names, not keys).
- **Purity and layering.** The review engine stays pure (injected provider only). The scoring function depends only on its inputs. Server code follows route → service → repository with adapters from the container. Schema changes go through `server/src/db/schema/*.ts` and `pnpm db:generate`; no hand-edited migrations.
- **Testing.** Every test that exercises execution uses a fake `LLMProvider`; real model calls happen only in the manual demo (D-8). DB-backed tests use the `*.it.test.ts` suffix.
- **Accessibility.** Result icons, kind badges, metric deltas, compare markings and the regressed/fixed groups carry text, not color alone. Run selection uses real checkboxes with accessible names that include the run time and version. Dialogs are labeled, close on Escape and return focus (AC-72). Progress and errors use `role="status"` / `role="alert"`.
- **Observability.** Start and end log lines per run, one per errored case (AC-48). Run status, counts, duration and cost are persisted (AC-29, AC-38).
- **i18n.** All new UI strings come from next-intl message files (an `evals` namespace plus `prReview` for the finding action), with plural forms for case(s) and run(s).
- **Compatibility.** Contract changes are additive and identical in both vendored copies if `vendor/shared` is changed (AC-82). Existing review runs, findings and traces are unaffected.

## Inputs and provenance

| Input | Provenance | Notes |
|---|---|---|
| Finding file, lines, accept/dismiss status | [reused: `findings` table, `accepted_at` / `dismissed_at`, mutually exclusive in `review.repo.ts`] | |
| Owner agent of a case | [reused: `reviews.agent_id` of the finding's review] | Nullable today (AC-9). |
| Diff fragment | [deterministic: hunk selection from the PR diff loaded like `reviews/diff-loader.ts` (`git diff base...head` or `pr_files` patches)] | Uses the PR's current head; findings refer to the head at review time (AC-11). |
| Case storage | [reused: `eval_cases` (`input_diff`, `input_meta`, `expected_output`, `notes`, `owner_kind = 'agent'`)] | Expectation and metadata fit the existing JSON columns; no column is missing for cases. `owner_id` has no FK (AC-22 needs explicit deletion). |
| Eval run (batch) and case results | [new: storage for a run across all cases, with agent id, version, manifest, status, counts] | `eval_runs` today is one row per case (`case_id` FK) with no agent, version, batch, status or counts; a run-level record is missing (OQ-2). |
| Agent version and manifest | [reused: `agents.version`, `agent_versions.config_json` (`AgentVersionConfig`)] | Snapshot lists skill ids only, not skill bodies or versions; the run adds skill versions (AC-33). |
| Skill bodies and versions | [reused: `skills.body`, `skills.version` of enabled linked skills] | |
| Findings per case | [reused: reviewer-core `reviewPullRequest` → `allFindings` (grounded) and `dropped`] | No intent passed, so the scope policy is inactive and all grounded findings are scored. |
| Grounding | [reused: reviewer-core `groundFindings` against the fragment] | Source of citation_accuracy. |
| Recall, precision, citation_accuracy, pass/fail, counts | [deterministic: new scoring function] | Zero LLM calls (AC-23). |
| Model review output per case | [new: 1 LLM call per case (the agent under test), via the existing review engine] | Not a grader call; scoring adds 0 calls. |
| Cost and tokens | [reused: `ReviewOutcome.costUsd`, `tokensIn`, `tokensOut`] | |
| Prompt diff in compare | [deterministic: word-level diff of the two manifests' system prompts] | The client already has an LCS token diff for skill versions (`VersionsTab/helpers.ts`). |
| Seeded cases | [new: fixture data, derived from seeded demo findings plus hand-written cases] | The seed has 3 findings on PR #482, none accepted or dismissed, so hand-written cases are required (OQ-9). |

## Untrusted inputs

Fed to the model by this feature:

- The case's diff fragment (code and file paths from a pull request, controlled by its author).
- The file path inside the fragment headers.
- Skill bodies (already part of the existing skills section; unchanged by this feature).

They reach the model only through the existing review engine, which wraps the diff as delimited untrusted data behind the shared `INJECTION_GUARD`; content inside the fragment cannot change the task, the output format, severity or policy. The case name, notes, expectation, origin and the source finding's title and rationale are never sent to the model (AC-35). Scoring is code and reads no model text other than the structured findings' file and line numbers. In the UI, fragments, paths, names and messages are rendered as plain text (AC-83).

## Decisions

Recorded from the user's requirements; not open.

- **D-1. Cases live in Postgres** (`eval_cases`) next to findings, owned by an agent.
- **D-2. Expectation from the decision.** Accepted → `must_find`; dismissed → `must_not_flag`; the user reviews the draft before saving and may change it (AC-4, AC-6, AC-7).
- **D-3. Scoring is code only**, zero LLM calls (AC-23).
- **D-4. Match rule.** Same file and overlapping line ranges; no semantic matching (AC-24).
- **D-5. citation_accuracy = grounding pass rate.** The stored and contract name stays `citation_accuracy`; docs and tooltips call it grounding pass rate and state that it measures whether cited lines exist in the diff, not whether the citation is correct (AC-28, AC-31).
- **D-6. Fixed inputs and recorded version.** Each case carries its own inputs; every run records the agent version and manifest so runs of different versions are comparable (AC-12, AC-33, AC-34, AC-36).
- **D-7. UI surfaces.** Evals tab in the Agent editor (cases, metric strip, run history, run all) and an Eval Dashboard page in the left sidebar (latest runs per agent, per-agent run table, select two runs → compare) (AC-15..AC-19, AC-49..AC-72).
- **D-8. Fake provider in tests**; a real model only for the demo (screenshots of a two-run comparison).
- **D-9. Out of scope:** Case Editor, trend charts, the `evals/` harness package, CI export, skill evals, hooks, mutation testing.
- **D-10. `pnpm verify:l06` is defined by this project** (no template exists) (AC-76, AC-77).
- **D-11. Workflow files are a hard stop.** This feature does not create or edit anything under `.github/workflows/`. Needed CI changes (for example `PROJECT_DOCS_SOURCE=fixture` for the e2e job, an optional `verify:l06` job) are listed in the docs and applied by the user manually after the lab.
- **D-12. Cost comparison across models** is done by changing the agent's model and running the same case set again; the compare view shows the model and cost difference (AC-68, AC-69). There is no multi-model matrix run in one action. Isolation between runs is guaranteed by AC-88.

## Open questions

Blocking (answers change ACs materially):

- **OQ-1 Precision for findings outside any labeled range.** A case's fragment can contain code the user never labeled; the model may flag it. Options: (a) strict: count such findings as false positives (precision = TP / all grounded findings); (b) lenient: exclude them (precision = TP / (TP + FP_zone)); (c) store both and show strict as the headline. **Recommended default:** (a) strict as the headline metric, with FP_unlabeled stored and shown separately (AC-27, AC-29), because the homework wording "share of returned findings that match positives and do not land in must_not_flag zones" puts every returned finding in the denominator, and strict precision is what makes a deliberately broken prompt visibly drop.
- **OQ-2 Contracts and storage for run batches.** `vendor/shared` is read-only for this task, yet the existing contracts lack: a run-level record (agent id, agent version, manifest, status, counts, case-result list), nullable metrics (`EvalRun` metrics are `number().min(0).max(1)`, not nullable), the case-result `status` and an `error` field, and a typed expectation (`expected_output` is `unknown`). `eval_runs` is one row per case with no batch, agent or version. Options: (a) additive edit of `contracts/eval-ci.ts` in both vendored copies in lockstep (precedent: SPEC-02 extended `trace.ts`), plus a new run table via `pnpm db:generate`; (b) keep `vendor/shared` untouched and define the new shapes in server- and client-local contract files with a parity test (precedent: `project-context/constants.ts` + `contracts-project-context.test.ts`); (c) squeeze runs into existing `eval_runs` rows (one row per case + a JSON batch key). **Recommended default:** (a), since the task is explicitly about the eval contract; new run table `eval_suite_runs` (name for the planner) referenced by `eval_runs`, which keep their per-case role. If the answer is "never touch vendor", use (b).
- **OQ-3 Where `pnpm verify:l06` lives.** The repository root has no `package.json` and is deliberately not a workspace. Options: (a) a minimal root `package.json` with `private: true`, no dependencies and only scripts (`"verify:l06": "bash scripts/verify-l06.sh"`), no `pnpm-workspace.yaml`; (b) only `scripts/verify-l06.sh` (then the command is `./scripts/verify-l06.sh`, not `pnpm verify:l06`); (c) a `verify:l06` script inside `server/package.json` that shells out to the other packages. **Recommended default:** (a) + the shell script, plus a PowerShell twin if Windows parity is wanted (`scripts/*.ps1` exist). Also confirm the default check list in AC-76 (server integration tests are excluded because they need Docker; add a `--with-integration` flag?).
- **OQ-4 Sidebar entry.** The sidebar items come from `client/src/vendor/ui/nav.ts`, which is a vendored read-only file (though "Conventions" was added there before). Options: (a) edit `nav.ts` to add "Eval Dashboard" (`/evals`, icon Gauge, shortcut `g e`); (b) inject the item from app code without touching the vendor file. **Recommended default:** (a), matching how Conventions was added.

Non-blocking (defaults applied in the ACs):

- **OQ-5 Version replay.** Should a run be able to target a stored past version (`POST /agents/:id/eval-runs {version}`) so "old vs new" needs no revert? Skill bodies of past versions are not stored, so a replay is only approximate. Default: no; run the current version only (non-goal).
- **OQ-6 Fixed inputs scope.** Store and pass the PR title (and description) with the case? They add realism but also untrusted text and drift. Default: diff fragment only with a neutral task line (AC-34).
- **OQ-7 Fragment size.** Cap the fragment (for example 400 changed lines or 32 KB) and trim to the hunk lines around the range, or keep whole hunks? Default: whole intersecting hunks, refuse above 32 KB with a message.
- **OQ-8 Limits.** Concurrency 3, per-case timeout 120 s, maximum 50 cases per run (AC-40, AC-44). Accept?
- **OQ-9 Seed set.** Derive from the 3 seeded PR #482 findings (marked accepted/dismissed in the fixture) plus hand-written cases to reach at least 8 (e.g. 5 `must_find`: hardcoded secret, SSRF, missing Retry-After, N+1 query, service-role key in client; 3+ `must_not_flag`: unused import, raw body parser for verified webhooks, clean refactor), all on Security Reviewer. Default: yes, as in AC-73.
- **OQ-10 Seed idempotency vs deletion.** The seed runs on every dev start (`server.ts`). Upserting fixed-id cases would re-create cases the user deleted. Default: insert seeded cases only when the agent has no seeded-origin cases yet; never re-create deleted ones.
- **OQ-11 Seeded runs and decided findings for e2e.** Seed two finished runs (AC-78) and mark one seeded finding accepted and one dismissed only in fixture mode, so e2e flows stay read-only and the developer's real workspace is untouched? Check that flow 04 is unaffected. Default: yes, fixture mode only.
- **OQ-12 Editing cases.** Allow editing name, kind and notes of a saved case (not the fragment)? Default: no (delete and recreate); the design's Edit icon is omitted.
- **OQ-13 Single-case run and "Run all agents".** The design shows a per-case Run button and a dashboard "Run all agents". Default: both omitted.
- **OQ-14 Run detail surface.** Show per-case results in a drawer from the runs table, or expand rows inline? Default: a drawer (AC-65).
- **OQ-15 CI.** Add a workflow that runs `pnpm verify:l06`, or rely on the existing path-filtered workflows? Default: rely on existing workflows; no new CI job.
- **OQ-16 Metric deltas baseline.** Delta against the previous finished run of the agent (any version), or against the previous run of a different version? Default: previous finished run (AC-51).
- **OQ-17 Spec path.** The homework names `specs/eval-pipeline.md`; this repository numbers specs. Default: `specs/03-eval-pipeline.md`; add a one-line `specs/eval-pipeline.md` pointer only if the grader requires the literal path.

### Design coverage gaps and proposals

- **No capture flow in the design.** The design shows cases with `from: accepted/dismissed` but no "Turn into eval case" dialog. Added the review dialog (AC-3..AC-14).
- **"must not flag" shown as "assert empty".** The design implies a whole-fragment empty assertion; the spec scopes it to the labeled zone and counts other findings as unlabeled (AC-25, AC-27, OQ-1).
- **"20-trace gold set" copy** is fixed text in the prototype; replaced by the real case count.
- **No running, error, partial, interrupted or empty states** for runs; no "no runs yet" or null-metric display. Added (AC-19, AC-38, AC-39, AC-47, AC-50, AC-52, AC-53).
- **No version-drift notice** when the agent changed since the last run. Added (AC-54).
- **Compare shows only metrics and the prompt diff.** Added per-case regressed/fixed lists, other manifest differences and differing case sets (AC-69..AC-71).
- **Selection by row click only.** Real checkboxes with accessible names (non-functional, AC-66).
- **Color-only deltas and pass/fail icons.** Text markers added (AC-51, AC-16).
- **No run detail.** Added (AC-65, OQ-14).
- **No confirm before spending.** Added (AC-57).
- **Out of scope in the design:** New eval case, per-case Run/Edit, trend chart, sparklines, "30 days", "Promote vN", "Run all agents", the regression alert banner, Skill Evals tab.

### Research suggestions (via caller)

- How the review route reports a missing provider key and its rate-limit settings, so AC-43 and AC-45 reuse them exactly.
- Whether `reviewPullRequest` with a one-file fragment can still select map-reduce for any agent strategy (sizing per-case cost).

### Verification notes

- Checked in code: `server/src/db/schema/eval.ts` (`eval_cases` JSON columns; `eval_runs` per case with `case_id` FK, no agent/version/batch/status); `vendor/shared/contracts/eval-ci.ts` (`EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`, `EvalDashboard` with trend and alert) and `knowledge.ts` (`EvalRun` non-nullable metrics, `EvalCase`, `AgentVersionConfig` with skill ids only); `modules/agents` (version bump and `agent_versions` snapshot on every config change, including `context_paths`); `findings` schema and `review.repo.ts` (accept/dismiss mutually exclusive); `reviews/findings.ts` (comment says eval cases come from accept/dismiss); `reviews/diff-loader.ts`; reviewer-core `grounding.ts` (inclusive range vs hunk new-side lines; full-file kinds) and `review/run.ts` (`allFindings` grounded, `dropped`, cost and tokens; `projectContext`, `intentObj` optional); OpenRouter provider default temperature 0; `FindingCard.tsx` (Accept/Dismiss only, no diff access); AgentEditor `TABS` (config, skills, context); `vendor/ui/nav.ts`; seed (3 findings, none decided; seed runs on every start); `e2e/specs/flows.md` (no flow may call a model; fixture mode). Design: `screen_agents.jsx` `EvalsTab`/`EvalMetricStrip`, `screen_skills.jsx` `AgentEvalOverview`/`ScreenEval`/`RunCompare`, `EvalCaseRow`, `EVAL` and `EVAL_CASES` fixtures.
- `get_blast_radius` was not run: the devdigest MCP tool is not available in this session and there is no PR for this feature yet.
