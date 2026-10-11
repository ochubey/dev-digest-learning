# Eval Pipeline (SPEC-03): decision log

Human-readable record of what was decided, what changed, why, and what it affects.
Spec: `specs/03-eval-pipeline.md` (rev 4). Plan: `docs/plans/eval-pipeline.md`. Demo: `docs/eval-pipeline-demo.md`.
Branch: `l06-evals-ci`, stacked on PR #18 (`feat/pr-brief`).

## 1. Decision table

| ID | Decision | Why | Alternatives rejected | Affects |
|---|---|---|---|---|
| D-A | Build the whole feature ourselves with AI, spec -> plan -> implement | Lab goal ("pure SDD"); no course template was available | Waiting for the instructor's `l06-evals` branch | Process |
| D-B | Follow the repo's own SDD flow (`specs/NN-*.md`, `docs/plans/`, `/run-plan`) from open PR #18 | `main` lacks `specs/` and the agents; the flow lives only in PR #18 | Generic `sdd:*` skills; copying files over | Branch base |
| D-C | Rebase `l06-evals-ci` onto `feat/pr-brief` (stacked PR) | The Evals tab edits `AgentEditor`, which PR #18 changes heavily; avoids conflicts | Branch from `main`; wait for the merge | PR base is `feat/pr-brief`, not `main` |
| D-D | Spec lives at `specs/03-eval-pipeline.md` | Repo numbers specs; homework named `specs/eval-pipeline.md` | Literal homework name | Spec path |
| OQ-1 | Strict precision: findings outside any labeled range count as false positives | Makes a deliberately broken prompt visibly drop precision; matches the homework wording | Lenient (exclude unlabeled) | Scoring formula (AC-27) |
| OQ-2 | Additive SPEC-03 block in both vendored `eval-ci.ts` copies + new table via `pnpm db:generate` | Existing contracts have no run-level record; precedent: SPEC-02 extended `trace.ts` | Local contracts with parity test; squeezing runs into `eval_runs` | `vendor/shared` (normally read-only), DB |
| OQ-3 | Minimal private root `package.json` calling `scripts/verify-l06.sh` | Homework requires `pnpm verify:l06`; no template existed; repo is not a workspace | Script only; script inside `server/` | Repo root |
| OQ-4 | Edit vendored `client/src/vendor/ui/nav.ts` to add "Eval Dashboard" | Same way "Conventions" was added | Inject from app code | Sidebar |
| A-1 | Parity of a marked block in `eval-ci.ts`, not the whole file | The two copies already differ; full parity would pull CI contracts into the client | Make files identical | Contract tests |
| A-2 | Missing provider key on eval start: HTTP 500 `config_error`, checked before any write | Same error the review path raises; nothing is written | 400/424 | API behavior |
| A-3 | In fixture mode only, Security Reviewer is bumped to v2 so seeded runs read "v1 -> v2" | Compare demo needs two different versions | Keep v1/v1 | Seed, demo data |
| A-4 / D-11 | `.github/workflows/**` is a hard stop; the user updates workflows manually after the lab | User instruction; token also lacks `workflow` scope | Editing CI ourselves | CI (see section 6) |
| D-12 | Cost comparison across models = change the agent's model and run the same cases again | No multi-model matrix in scope | Matrix run | Compare view |
| AC-88 | Each case is a separate stateless model call: no tools, no history, no access to other cases/runs/results | User had seen models "cheat" by reading other runs | Shared session | Runner, tests |
| Cut | Scope cut: AC-45, 47, 57, 62, 63, 71, 72, 84, 85 demoted to P3 | 86 ACs is large for ~5h | Do everything at P1 | Spec priorities. In the end all but AC-86 were implemented anyway (cheap, part of planned components) |
| Auto | User allowed commits, push, token spend and changes, everything except workflows | User instruction (2026-10-11) | Per-phase approvals | Process |
| Lang | Chat in Ukrainian; docs, code, commits in English | User instruction | - | Process |
| R-1 | Architecture review fixes: builders and `mapLimit` moved to `platform/`; agent-delete cleanup via container hooks (agents no longer imports evals); named `DbOrTx` type | Wrong-direction imports (db -> modules), module coupling, double cast | Leave as is | Layering, `agents` module |
| R-2 | Security review fixes: strict run cursor (400), generic message for 5xx, wider secret redaction, caps (notes 2000, file 500, 50 cases per agent -> 409), expectation must match the source finding, max 3 concurrent runs per workspace (409) | Review findings MEDIUM-1/2, LOW-1/2/3 | Accept all | API behavior |
| R-3 | Accepted risks: AbortSignal after case timeout not plumbed into reviewer-core (a timed-out call may still be billed); no per-workspace daily budget; app is local, single-user, no auth | Needs a reviewer-core change; low exposure | Change reviewer-core | Security notes |
| R-4 | Kept: adapter import of `parseUnifiedDiff` (existing repo pattern), notes A6-A8 of the architecture review | Not worth churn | Refactor | - |
| V-1 | Overview "latest/previous" uses only `completed` and `completed_with_errors` runs | Verifier: a failed run could be shown as latest | Include failed | Dashboard correctness (AC-59/61) |
| V-2 | Run total cost = sum of known costs of scored cases (errored cases ignored) | A real run: one timed-out case made the whole cost null | Literal "null if any unknown" | AC-38 (spec rev 4) |
| V-3 | "Cases passed" everywhere uses scored cases as denominator (e.g. 6/8) | Header badge and card disagreed (6/8 vs 6/9) | cases_total | UI (AC-18/51) |
| V-4 | Run detail opens from the Evals tab history too; drawer and dialog moved to `client/src/components/evals/` | AC-65; shared across two routes | Duplicate | Client structure |
| E-1 | New env `RATE_LIMIT_MAX` (default 120, unchanged behavior); `scripts/e2e.sh` sets 5000 | One browser running 13 flows exceeded 120 req/min and got 429s | Slow the flows down | Server config, e2e |
| E-2 | Flow 14 (turn a finding into a case) not written | The only decided finding in fixture mode already has a seeded case, so the dialog shows "Already an eval case" | Another seeded decision (risks flow 04) | AC-86 skipped |

## 2. Changes by commit (oldest first)

| Commit | What changed |
|---|---|
| `fe87cc5` | SPEC-03, implementation plan, lesson digest |
| `c8077b3` | Contracts: SPEC-03 block in both `eval-ci.ts` copies (additive), parity test, client constants mirror |
| `dab1176` | Migration `0015`: `eval_suite_runs` (one running run per agent via partial unique index), new `eval_runs` columns, nullable `case_id` with `set null`, unique index on a case's source finding |
| `b37fe86` | Pure modules: matching, scoring, fragment builder, draft, validation, finalize, log lines; import-graph purity test |
| `d3ad85b` | Runner (one stateless call per case), repository, service, routes, boot reaper, case cleanup on agent delete |
| `d63e97d` | Seed: 9 Security Reviewer cases; fixture mode: v2 agent, two runs, accepted Stripe finding; prompt-aware fake provider experiment test |
| `3522896` | `pnpm verify:l06` (root `package.json`, `scripts/verify-l06.sh`), README and AGENTS.md notes |
| `3663af4` | Client hooks, text-diff extraction, helpers, "Turn into eval case" button and dialog |
| `94cf793` | MetricStrip, ScoringNote, RunEvalControl |
| `5f26897` | Architecture and security review fixes, server README, reviewer-core contract note, `docs/eval-scoring.md` |
| `ce740e7` | Agent Evals tab |
| `efb137c` | Eval Dashboard, per-agent page, run detail drawer, compare dialog, sidebar entry |
| `8a7f451` | e2e flows 12 and 13, `RATE_LIMIT_MAX`, compare screenshot |
| `5e53c30` | Overview ignores failed runs, cost sum rule, isolation IT on the real DB, service log test, demo script, spec rev 4 |
| `3f98087` | Run detail from the Evals tab, scored-cases denominator, `?tab=evals` page test, client README |

## 3. Deviations from the spec or plan (with reasons)

- `AC-82`: only the marked block is byte-identical in both contract copies (A-1).
- `AC-43`: eval start returns 500 `config_error`, because a PR review start does not refuse a missing key at all.
- Validation errors: Zod answers 422 in this app, so service-level validation answers 400 and malformed UUIDs answer 422.
- `AC-8`: after saving, the dialog shows a saved state with a link instead of closing, because the app toast cannot carry a link.
- `AC-38` (rev 4): cost is the sum of known costs of scored cases (see V-2).
- Fixture mode marks only the Stripe finding accepted (N+1 stays undecided) to avoid breaking e2e flow 04; the N+1 derived case still has origin `dismissed_finding`.
- Extra validation beyond spec: name over 80 chars, empty file, fragment over 32 KB, notes and file caps, cross-check with the source finding.
- `AC-34`: the model still sees `INJECTION_GUARD` in the system prompt and the diff wrapped in `<untrusted>`; both are identical for every run.
- `AC-86` skipped (E-2). Some tests were written in the same pass as the code instead of strictly first.

## 4. Verification results

- `pnpm verify:l06` from the repo root: `verify:l06 OK` (server, client, reviewer-core typecheck and unit tests, seed fixture, scorer purity, prompt experiment; no Docker, DB, network or keys). Failure path checked by breaking one assertion: exit 1 and "FAILED at step: server unit". Not tested with the network physically off.
- Server unit suite 785 tests, client suite 531 tests, Docker integration tests for evals, agents versions, seed and demo reset all passing at the time of each commit.
- Hermetic e2e (`./scripts/e2e.sh`): 13/13 flows passed on the first full run after flows 12-13 were added (re-run after the last client commit is recorded in section 7).
- Plan verifier matrix (before the fixes of `5e53c30` and `3f98087`): 81 PASS, 4 PARTIAL, 2 MISSING (AC-87 demo script, AC-86 skipped). The PARTIAL items (AC-59, AC-61, AC-65 and the weak AC-23/AC-79 tests) were fixed afterwards; AC-87 is `docs/eval-pipeline-demo.md`.
- Real-provider demo (2026-10-11), Security Reviewer, `openrouter/deepseek-v4-flash`: run A original prompt recall 60% / precision 60%; run B noisy prompt recall 100% / precision 50% (one case timed out); run C original restored recall 80% / precision 56%. The A -> C difference with an identical prompt is model noise (one trial per case).

## 5. Impact summary

- **Database:** one new migration (`0015`): new table `eval_suite_runs`, extra columns on `eval_runs`, relaxed `case_id` FK, new unique index on `eval_cases`. Run `pnpm db:migrate` on every dev database.
- **API:** new endpoints for case draft/create/list/delete, eval run start/list/detail/compare, overview. Rate limit 10 per minute on run start; 3 concurrent runs per workspace; 50 cases per agent.
- **Behavior of existing features:** none changed for reviews, findings or traces. Eval runs create no `agent_runs`, `reviews` or `findings` rows. Deleting an agent now also deletes its eval cases (same transaction). Server 5xx responses now return a generic message. New env `RATE_LIMIT_MAX` (default unchanged).
- **Dev seed:** 9 eval cases on Security Reviewer always; in fixture mode also a v2 prompt, two runs and one accepted finding.
- **Shared code:** `VersionsTab` word diff moved to `client/src/lib/text-diff.ts`; `reviews/diff-loader.ts` types widened; `mapLimit` moved to `platform/`.
- **Repo root:** new `package.json` (scripts only). Never run `pnpm install` at the root.
- **Dev DB changes made during this work (your local database):** migration `0015` applied; nine seeded eval cases added to Security Reviewer; three real eval runs recorded; Security Reviewer agent is now at version 5 (v4 = deliberately noisy prompt, v5 = original text restored byte-for-byte, `enabled` unchanged).

## 6. Manual follow-ups for the user (not part of autonomous work)

1. **Workflows (hard stop, not touched):** in `.github/workflows/e2e-web.yml` add on the API step `PROJECT_DOCS_SOURCE=fixture` (needed by flows 09-13; flows 09-11 from PR #18 already need it) and `RATE_LIMIT_MAX=5000`. Optionally add a job running `pnpm verify:l06` (needs Node and pnpm installs for server, client and reviewer-core, no Docker or secrets). The reminder is repeated when the PR is created.
2. Record the screencast of the flow in `docs/eval-pipeline-demo.md` (script is there) and use the screenshot of the two-run comparison.
3. Revert the laptop sleep setting if you changed it: `sudo pmset -a disablesleep 0`.
4. Optionally restore your Security Reviewer's version history to your liking (v4 is the deliberately noisy prompt).

## 7. Log of later steps

- 2026-10-11 evening (readiness check against the homework page `TaskL06.html`): added `specs/eval-pipeline.md` (symlink to the numbered spec, the checklist names that path), made the compare dialog show the system prompt diff as lines with context and a collapsed unchanged block (the earlier screenshot did not show the changed prompt), added e2e flow 14 (capture dialog: draft, "Must find", `src/config.ts` line 12, "Already an eval case"), retook `docs/eval-pipeline-compare-real.png` (real runs v3 vs v4), added the recording checklist and submission steps to `docs/eval-pipeline-demo.md`. Full e2e: 14/14 flows; `pnpm verify:l06` OK.
- Homework page facts: deadline 2026-10-11 23:45; submit a link plus an optional file up to 150 MB (the screencast).

- Full hermetic e2e re-run after the last client commit: 13/13 flows passed.
- Side effect found and repaired: `scripts/e2e.sh` runs `next dev -p 3100` in the same `client/.next` as a developer's dev web on :3000, which left the user's dev web pointing at the e2e API (:3101). The dev web was restarted with a clean `.next` (recorded in `e2e/INSIGHTS.md`); a separate `distDir` for the e2e web is a possible follow-up.
- Real-run screenshot of the compare dialog saved as `docs/eval-pipeline-compare-real.png`.
