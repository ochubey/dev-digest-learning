# Plan: "PR Self Review" dispatcher skill

Status: PLAN ONLY. Not implemented — no skill file, no hook, no code written.

## 1. Trigger

Two entry points, both should land on the same underlying routine:

- **Manual**: `/pr-self-review` slash command (or invoked by name via the Skill tool).
- **Pre-PR-open**: no native "before `gh pr create`" hook exists in this harness today
  (checked `.claude/settings.json` — no hooks configured at repo level). Two options,
  decide at implementation time:
  a. A `PreToolUse` hook on Bash matching `gh pr create` (blocks the command, runs the
     dispatcher, and only lets the real `gh pr create` through after a pass/ack).
  b. Advisory-only: the skill's own description tells agents to self-invoke it before
     ever running `gh pr create`, same convention as `security-review`'s "Complete a
     security review of the pending changes" pattern already in this repo's skill list.
  (a) is a hard gate, (b) is a convention — plan should note this is an open decision,
  not resolve it, since it's a harness-config choice outside the skill's own scope.

## 2. Step 1 — compute the diff surface

- Base branch: same resolution `code-review`/PR-creation flows already use —
  `git merge-base HEAD origin/main` (fall back to `main` local if no `origin`).
- Diff scope: `git diff --name-only <merge-base>...HEAD` UNION uncommitted changes
  (`git status --porcelain` + `git diff --name-only` for unstaged, `git diff --cached
  --name-only` for staged) — per the requirement ("відкриті/непушнуті локальні
  зміни" = uncommitted AND committed-but-unpushed-relative-to-base), the full surface
  is: everything that differs from the base branch tip, committed or not.
- Output of this step: a flat list of changed file paths, each tagged with its status
  (added/modified/deleted) — deleted files are excluded from "run skill on this file"
  matching (nothing to lint) but kept in the report for visibility.

## 3. Step 2 — map changed files → relevant skills

Two-tier matching, in priority order:

1. **Path-prefix rules** (primary mechanism — cheap, deterministic, no LLM judgment
   needed for the common case):

   | Path prefix | Skills to run |
   |---|---|
   | `client/**` | `ui-architecture`, `react-best-practices`, `next-best-practices` |
   | `client/**/*.test.tsx`, `client/**/*.test.ts` | + `react-testing-library` |
   | `server/**` | onion-architecture rules (once that skill exists — today apply
     `docs/onion-architecture-skill-plan.md`'s rules manually, same as this session did),
     `fastify-best-practices` |
   | `server/src/db/**`, `*schema.ts` | + `drizzle-orm-patterns`, `postgresql-table-design` |
   | any `*.ts`/`*.tsx` touching `z.object`/`z.string` etc (detected by content grep,
     not path) | + `zod` |
   | any file (always, if diff non-empty) | `security` (OWASP-relevant on any surface
     — auth, input handling, secrets can appear anywhere) |
   | `reviewer-core/**`, `e2e/**` | no dedicated skill in the current list — flag as
     "no skill coverage" rather than silently skipping (matches the "don't skip
     silently" convention this session's server refactor already followed) |

2. **Fallback for unmatched paths**: any changed file not matched by a path-prefix rule
   above (e.g. root configs, `docs/**`, `.claude/**`) is listed in the report under
   "not covered by any skill" — not an error, just visibility so gaps in skill coverage
   are seen, not silently ignored.

   Path-prefix matching is preferred over an LLM-judgment classification step because
   it's deterministic and auditable — a dispatcher whose skill selection changes between
   runs on the same diff would be worse than one with static, documented rules.

## 3a. Large-diff handling (edge case)

A diff of 50+ files or 2000+ changed lines (e.g. a rebase, a generated-file bump, a
big rename) makes full-skill-per-file review slow and noisy. Rules:

- **Budget check before running any skill**: if changed-file count or total diff line
  count exceeds a threshold (suggest: 40 files OR 1500 lines — tune later), switch
  from "run every matched skill on every file" to a two-pass mode:
  1. Pass 1 (cheap): path-prefix classification only (§3) + a lightweight grep-based
     scan per skill's known anti-pattern keywords (e.g. `useEffect` for react rules,
     `new SomeAdapter(` for onion rules) to shortlist files that are LIKELY to have
     findings.
  2. Pass 2 (expensive): full skill review only on the shortlisted files, capped at
     N files per skill (suggest: 25) — remaining files listed in the report under
     "not deep-reviewed (diff too large — grep pass only)" rather than silently
     skipped.
- **Generated/vendored/lockfile diffs excluded from skill matching entirely** (not
  just deprioritized): `pnpm-lock.yaml`, `*/migrations/**`, `client/next-env.d.ts`,
  `*/vendor/**`, `package-lock.json` — these are Do-Not-Touch per each package's
  CLAUDE.md already; a self-review flagging hand-written-looking issues in a
  generated file is pure noise. List them in the report under a separate "generated,
  skipped" line, count only, no per-file detail.
- Report must say up front whether it ran full or two-pass mode, so the user knows
  how much confidence to place in a clean result on a huge diff.

## 3b. Skill-conflict handling (edge case)

Two skills can recommend contradictory things on the same file (e.g. `ui-architecture`
says "promote this util to shared/lib" while a hypothetical perf-focused skill says
"keep it colocated to avoid a shared-module bundle-size hit" — or more concretely today:
`react-best-practices`' 200-line-component guideline vs `ui-architecture`'s "don't
split a component that has no shared reuse just to hit a line count").

- Findings are never silently merged or auto-resolved when two skills disagree on the
  SAME file+line with different prescribed fixes. Instead:
  - Emit both findings, each tagged with its source skill.
  - Add a `conflicts_with: [<other finding id>]` field so the report visibly groups
    them under a "Conflicting recommendations — needs a judgment call" subsection,
    separate from the normal severity buckets.
  - A conflict is NEVER auto-escalated to critical and never blocks merge by itself —
    it's surfaced for a human/agent decision, not treated as a defect.
- Precedence when the dispatcher itself must pick one to act on (not "decide for the
  user" — only for report ORDERING): more specific skill wins over more general
  (e.g. `ui-architecture`, which is specific to this repo's directory conventions,
  outranks `react-best-practices`, which is a generic pattern guide) — listed first
  in the conflict group, not auto-selected as "the answer."

## 3c. Skill/tool failure handling (edge case)

- If a matched skill errors out, times out, or a subagent invocation crashes mid-review:
  do NOT treat that as "no findings from this skill" (silent pass) — report it
  explicitly as `SKILL_ERROR: <skill name> — <short reason>` in its own report section,
  and the overall verdict becomes `BLOCKED (needs manual review — N skill(s) failed to
  run)` rather than a false PASS. A crashed reviewer is not evidence of a clean diff.
- Retries: one retry per failed skill before giving up and reporting the error (some
  failures are transient — subagent spawn hiccups, rate limits).

## 4. Step 3 — run each matched skill against the diff

- For each skill selected in step 2, invoke it (Skill tool) scoped to the CHANGED
  FILES ONLY, not the whole package — pass the file list + diff hunks as the skill's
  input context, same restriction `code-review` already applies ("review the diff",
  not the whole repo).
- Skills that are pure reference/pattern guides (e.g. `zod`, `drizzle-orm-patterns`)
  act as a checklist the dispatcher applies itself while reading the diff, rather than
  agents that "run" independently — clarify at implementation time which skills in the
  current list are dispatcher-checklist style vs which (like a future onion-architecture
  skill) are meant to actively scan and emit findings.
- Each skill's output must conform to the finding shape in §6 (this is a NEW
  requirement this plan introduces — existing skills like `react-best-practices` don't
  currently emit structured findings, they're guidance docs. The dispatcher is
  responsible for translating skill guidance + diff into findings itself, OR the
  skills need a structured-output convention added — flag as an open dependency,
  not resolved by this plan).

## 5. Step 4 — aggregate findings

- Collect all findings from all invoked skills into one flat list.
- Deduplicate: same file+line+category from two skills → keep once, note both sources.
- Sort: severity (critical → worth-fixing → optional), then file path, then line.

## 6. Report structure

Terminal-readability requirements first (this is read in a scrolling CLI, not a
rendered doc — the shape below follows from these):
- **Verdict line FIRST, not last** — a terminal user scrolling up should see PASS/
  BLOCKED before wading through findings. Repeat it at the end too (long reports
  scroll past the top).
- **One-line-per-finding summary block up top**, full detail below — so a clean skim
  (`file:line — one-sentence summary [severity]`) is possible without reading every
  finding's full rule/fix text; the detail section is for when something needs acting on.
- Cap total findings shown at full detail (suggest: 30) — beyond that, show the
  one-line summary for all, full detail for CRITICAL + first N of the rest, and a
  count of how many were truncated ("+18 more worth-fixing findings, see full report
  at <path>" — write the untruncated version to a file, e.g.
  `.claude/pr-self-review-<timestamp>.md`, for anyone who needs it all).

```
PR Self-Review — <branch> vs <base>          [PASS | BLOCKED — N critical]
Files changed: N (M skill-covered, K generated/skipped, J not covered)
Mode: full review | two-pass (large diff, see §3a)

── Summary ──────────────────────────────────────────────
[CRIT] server/src/modules/x/routes.ts:42 — raw DB call bypasses service layer
[WARN] client/src/app/y/page.tsx:10 — useEffect syncs derived state
[INFO] client/src/lib/utils.ts:5 — duplicated magic string, promote to constants
... (one line each, all findings, no truncation in this block)

── CRITICAL (blocks merge) ──────────────────────────────
<file>:<line> — <summary>
  rule: <skill/source>
  fix: <suggestion>

── Worth fixing ─────────────────────────────────────────
  (same shape, truncated at cap — see note above)

── Optional ──────────────────────────────────────────────
  (same shape, collapsed to summary-only by default — expand on request)

── Conflicting recommendations (§3b) ────────────────────
  (grouped pairs/groups, needs a judgment call, does not block)

── Not covered by any skill ─────────────────────────────
- <file> — no matching skill for this path (reviewer-core/e2e/docs/config)

── Skipped (generated/vendored) ─────────────────────────
K files (pnpm-lock.yaml, migrations/**, ...) — count only

── Skill errors (§3c) ───────────────────────────────────
- SKILL_ERROR: <skill> — <reason> (retried once, still failed)

Verdict: PASS | BLOCKED (N critical findings)
```

- Machine-readable companion (for hook/CI consumption): same data as JSON —
  `{ verdict: "pass"|"blocked", critical_count, findings: [...] }` — needed if the
  hard-gate hook option (§1a) is chosen, since a hook needs a parseable exit signal,
  not just prose.
- Color/severity markers (`[CRIT]`/`[WARN]`/`[INFO]` or ANSI color if the terminal
  supports it) on every summary line — severity must be scannable without reading text.

## 7. Verdict rule

- **BLOCKED** iff at least one finding has severity `critical`. Exactly matches your
  requirement — no threshold tuning (e.g. "3+ worth-fixing = block") unless later
  requested.
- **PASS** otherwise, even with worth-fixing/optional findings — those are surfaced in
  the report but don't block.
- The verdict is advisory unless the hard-gate hook (§1a) is implemented; until then
  "block merge" means the report says BLOCKED and the agent refuses to run `gh pr
  create`/push-and-open on its own initiative, not a technical impossibility — the
  user can always override. This matches how `security-review` and `code-review`
  already work in this harness (report + agent judgment, not an OS-level lock).

## 8a. Incremental re-run (edge case)

Real workflow: run self-review, fix CRITICALs, run again before opening the PR. Running
the full review from scratch every time is wasteful once the diff is 90% the same.

- Cache prior run's findings keyed by `(file, content-hash-of-that-file's-diff-hunk)`
  in `.claude/pr-self-review-cache.json` (gitignored, ephemeral — not committed).
- On re-run: files whose diff hunk hash is unchanged since last run skip re-review,
  reuse their cached findings; only changed/new files get re-reviewed. Report notes
  "N files reused from previous run (unchanged since <timestamp>)".
- Cache invalidates wholesale if the base branch moved (new merge-base) — stale
  findings against an old base aren't trustworthy.

## 8b. Suppressing a known/accepted finding (edge case)

Without a suppression mechanism, a team either fixes everything or the same accepted-
risk finding blocks every future run.

- Inline suppression comment convention (matches common lint-suppression patterns):
  `// pr-self-review-ignore: <category>` on the line above, or `<file>: <category>`
  entries in a `.claude/pr-self-review-ignore.json` for file-wide/repo-wide
  suppressions (e.g. a legacy file mid-migration to the onion structure).
- A suppressed CRITICAL still appears in the report under "Suppressed (not blocking)"
  — visibility without blocking, never a silent drop. Suppressing is a decision that
  should stay visible, not disappear the finding entirely.
- Suppression requires a reason string, not just a category — `// pr-self-review-
  ignore: onion-layering — legacy file, tracked in TICKET-123`. No reason = the
  suppression itself is flagged as a lint issue by the dispatcher.

## 8c. Noisy/low-value skill runs (edge case)

- If a skill (e.g. `security`, run on every diff per open item §8.4) produces zero
  findings across many consecutive runs on a given file, that's fine and expected —
  don't treat "no findings" as a signal to stop running it. But DO track (locally,
  in the same cache file as §8a) which skill×path-prefix combos have never produced
  a finding above `optional` in the last N runs, and surface that as an aside
  ("security skill: 0 findings in 20 runs on client/** — consider narrowing its
  trigger scope") — advisory only, never auto-disables a skill.

## 9. Open dependencies / decisions for the skill-authoring step

(item 4 below is the "run security on every diff?" question referenced from §8c)

1. Hard gate vs advisory trigger (§1) — needs a decision on hook config.
2. Onion Architecture skill doesn't exist yet as a real skill (still just
   `docs/onion-architecture-skill-plan.md`) — dispatcher's server-side coverage is
   partial until that's authored.
3. Structured-finding-output convention doesn't exist for most current skills (§4) —
   either the dispatcher does the translation work itself, or each skill needs a
   companion "findings mode."
4. Whether `security` skill runs on every diff (broad, could be slow/noisy) or only
   when content-matched (auth/input/secrets keywords) — this plan defaults to "always"
   per OWASP's own guidance that vulnerabilities aren't confined to any one path, but
   that's a cost/noise tradeoff worth revisiting.
