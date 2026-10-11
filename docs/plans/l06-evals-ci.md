# L06 — Evals + Export to CI: master plan (rev 2)

Branch: `l06-evals-ci`. Method: **pure SDD, built by AI ourselves** — analyze → spec → plan → implement (TDD) → review. Sources: slides, lecture + lab transcripts (.sbv), lab text, homework text, lab design bundle.

## 1. Deliverables (graded vs practice)

| Track | What | Status |
|---|---|---|
| **HW (graded, ~5h, core)** | **Eval Pipeline for DevDigest product** + spec `specs/eval-pipeline.md` + `pnpm verify:l06` green + screenshot of 2-run comparison + screencast | primary |
| **Lab (practice)** | `evals/` harness package, 5 experiments, CI wiring | build first as tooling / learning, scope-limited |
| **Stretch** | own-skill eval in `evals/`, manual Case Editor, trend charts, PreToolUse test-gate hook, mutation testing | after core |

Homework acceptance criteria (the contract for the spec):
- ≥ 8 eval cases in the agent's set
- case created from a finding in one click; both `must_find` (accepted) and `must_not_flag` (dismissed) work
- changing the system prompt visibly moves recall/precision between two runs
- scoring makes **zero LLM calls**
- `pnpm verify:l06` green

User stories: create case from finding · see all cases of an agent · run agent on all cases · see recall / precision / citation_accuracy · open run history and compare two runs side by side ("old prompt vs new").

## 2. Product Eval Pipeline — requirements digest

- Tables `eval_cases`, `eval_runs` and Zod contracts are "given" — already in repo (`server/src/db/schema/eval.ts`, `server/src/vendor/shared/contracts/eval-ci.ts`). `vendor/shared` is read-only; if a contract gap appears (e.g. `agent_version_id`, expectation kind `must_find|must_not_flag`, file/line range fields) record it as an open question rather than editing.
- Button **Turn into eval case** on `FindingCard`: stores diff fragment + file + line range + expectation (accepted→`must_find`, dismissed→`must_not_flag`). User can review before saving (dismiss ≠ always "no problem").
- `POST /agents/:id/eval-runs`: run agent on all cases with **fixed inputs** so runs of different agent versions are comparable; persist `eval_runs`, record the agent version/manifest (`agent_versions`).
- Scoring in code only: match = same file and overlapping line ranges.
  - recall = share of positive `must_find` cases with ≥1 matching finding
  - precision = share of returned findings that match positives and don't land in `must_not_flag` zones — **formula for findings outside any labeled range must be fixed in the spec**
  - citation_accuracy (call it `grounding_pass_rate` in docs) = share of findings surviving the grounding gate
  - documented limits: line match is not semantic; shifted lines can miss.
- UI: **Evals tab** in AgentEditor (case list, run history, metric strip, run all, new case); **Eval Dashboard** page in left sidebar (overview of every agent's latest run + recent runs; per-agent trend + table; select two runs → Compare). Design: bundle `screen_agents.jsx` (EvalsTab, EvalMetricStrip), `screen_skills.jsx` (ScreenEval, RunCompare, AgentEvalOverview, SkillEvalsTab).
- Experiment: two runs old vs new prompt → metrics move; then deliberately break the prompt → precision drops.
- Verification: `pnpm verify:l06` (not in repo; root has no `package.json`).

## 3. Lab (harness) — `evals/` package digest

Lab uses an instructor `evals/` template (branch `upstream/l06-evals`; no `upstream` remote here). Per the task goal we **build it ourselves**, matching the described interface.

- Stack: pnpm + Vitest + Claude Agent SDK, standalone package at repo root, live model sessions (set model, budget, timeout, trials first).
- Layout: `evals/skills/<n>/<n>.eval.ts` + `<n>.cases.ts` + `fixtures/` (fixtures **outside** the skill dir so the model can't read seeded violations as docs), `evals/agents/<n>/…`, `evals/workflow/…`, `evals/results/records.jsonl`.
- Commands: `eval:quality` (static, no LLM), `eval:skills`, `eval:agents`, `eval:workflow`, `eval:repeat`, `eval:delta`, `eval:benchmark`.
- Graders: static → mechanical (patternMatch) → binary LLM judge with evidence/citations, other model family; fixtures untrusted data.
- Experiments: (1) Skill Creator on `.claude/skills/zod`; (2) break `onion-architecture` (remove DI-container rule) → targeted expectation fails → restore; own-skill case with 3–5 expectations + negative prompt; (3) architecture-reviewer v A/B (drop "cite rule") with spread; (4) workflow: dispatch (architecture-reviewer), positive + negative `engineering-insights` activation, control/treatment for CLAUDE.md (reads `api-contracts.md`; control in isolated dir), read-only allow-list, ≤6 merged sessions, repeats ≤2; (5) routing table in `AGENTS.md` + CI.
- Lab gotchas: pass `allowedTools` (else "no tools available" flakiness); calibrate on the original agent before comparing variants; per-case timeout; paired, alternated trials (do **not** cache one control); anchor-document assertions not exact paths; `claude -p --output-format stream-json --verbose --max-turns --max-budget-usd --no-session-persistence`; `--bare` skips CLAUDE.md/skills/hooks.
- Routing table to add to project instructions:
  `.claude/skills/**` → eval:quality + skill eval · `.claude/agents/**` → agent eval + workflow case · `CLAUDE.md`/routing → eval:workflow · eval case/grader change → recalibrate baseline.

## 4. CI (lab exp. 5 + final part)

- `eval:quality` **blocking** (free); model evals report-only first. paths filter, `concurrency`, `timeout`, budget; changed skill → that skill's eval, changed agent → agent eval, changed `CLAUDE.md` → workflow; no evals → log `skip`.
- Provider: OpenRouter (cheap judge/agents; lab ended on Haiku-class after DeepSeek flaked; Gemini-flash for workflow per README), model switch as workflow input/env. Secret `OPENROUTER_API_KEY` (repo secret) — name to confirm.
- Safety: read-only `permissions`, no secrets for fork PRs, secrets only in GitHub Secrets, no secret/private prompts in artifacts, comments/merge as separate permissions; tune thresholds/models, never delete cases to go green.
- Product-side Export to CI (`CiService`, `AgentManifest` YAML, `.devdigest/agents/<slug>.yaml`, gha first) is the "Export two agents" part of the lab title — check the design's Agent **CI tab**; not in HW checklist, treat as follow-up unless user says otherwise.

## 5. Proposed SDD features (slugs) & order

1. `eval-pipeline` (HW core): server module + scoring + routes + FindingCard button + Evals tab + Dashboard + compare → spec at **`specs/eval-pipeline.md`** (HW-mandated path; SDD artifacts under `docs/features/eval-pipeline/` link to it).
2. `verify-l06`: script + checks that back `pnpm verify:l06` (needs to know what it must verify — see Q2).
3. `harness-evals`: `evals/` package + quality gate + skill/agent/workflow evals.
4. `harness-evals-ci`: GitHub workflow + routing table in `AGENTS.md`.
5. Stretch items as separate small features.

Suggested order: 1 → 2 → 3 → 4 → stretch (HW is graded and largest; harness tooling is also useful to evaluate the pipeline's own agent prompts).

## 6. Open questions

1. **Order/scope**: start with the graded HW (`eval-pipeline`) — agreed? Do the lab harness package in full, or minimal (quality gate + one skill + workflow)?
2. **`pnpm verify:l06`**: no root `package.json`/script and no `upstream` remote exist. Is the verify script supplied by the template branch (URL/zip needed), or do we author it (what should it check — typecheck, tests, ≥8 seeded cases, no LLM imports in scorer)?
3. Contract gaps in read-only `vendor/shared` (expectation kind, line range, agent_version link, citation metric) — allowed to update the shared source if needed?
4. Eval run execution: use real LLM via existing reviewer-core on fixed inputs (cost) vs recorded/stub provider in tests — confirm tests use a fake `LLMProvider`.
5. CI provider/secret name and blocking policy (above).
6. Seed: 8+ cases need real findings — derive from seeded demo data/accept-dismiss history, or hand-write fixtures?

## 7. Conventions & guardrails

Conventional Commits with scope (`feat(evals):`, `ci(evals):`, `docs(plans):`) · no lint step in CI · never hand-edit migrations/lockfiles/`vendor/shared`/`skills-lock.json` · server follows onion rules (route → service → repository, adapters via container; reviewer-core stays pure) · client follows ui-architecture (kebab folders, barrel, colocated constants/helpers/styles) · record findings in INSIGHTS.md at the end · cost control: Haiku/Sonnet, ≤2 repeats locally.
