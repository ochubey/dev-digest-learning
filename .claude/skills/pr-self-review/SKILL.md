---
name: pr-self-review
description: Workflow dispatcher — before opening a PR (or on manual invocation), computes the diff surface, routes changed files to the relevant architecture/pattern skills (client/** -> ui-architecture + react-best-practices + next-best-practices; server/** -> onion-architecture + fastify-best-practices), runs them, and blocks merge if any CRITICAL finding surfaces. Invoke manually with /pr-self-review, or before ever running `gh pr create`.
---

# PR Self Review (workflow dispatcher)

Full design: `docs/pr-self-review-skill-plan.md`. This file is the operable
summary — read the plan doc for edge-case handling (large diffs, conflicting
skill recommendations, incremental re-run, suppression) before extending this.

## Trigger

- Manual: `/pr-self-review` or invoked by name.
- Convention: self-invoke before ever running `gh pr create` on this repo, the
  same way `security-review` is expected to run before a security-sensitive
  change ships. No hard hook is wired for this yet (see plan §1) — this is
  advisory today, not an OS-level gate.

## Step 1 — compute the diff surface

Everything that differs from the base branch tip, committed or not:

```
git merge-base HEAD origin/main   # or local main if no origin
git diff --name-only <merge-base>...HEAD   # committed, unpushed
git status --porcelain                      # + unstaged/staged
```

Tag each file added/modified/deleted. Exclude generated/vendored paths from
skill matching entirely (not just deprioritized): `pnpm-lock.yaml`,
`*/migrations/**`, `client/next-env.d.ts`, `*/vendor/**`, `package-lock.json`
— list them under "skipped (generated)" in the report, count only.

## Step 2 — route changed files to skills (static, deterministic)

| Path prefix | Skills to run |
|---|---|
| `client/**` | `ui-architecture`, `react-best-practices`, `next-best-practices` |
| `client/**/*.test.{ts,tsx}` | + `react-testing-library` |
| `server/**` | `onion-architecture`, `fastify-best-practices` |
| `server/src/db/**`, `*schema.ts` | + `drizzle-orm-patterns`, `postgresql-table-design` |
| any file touching `z.object`/`z.string` | + `zod` |
| any file (diff non-empty) | `security` |
| `reviewer-core/**`, `e2e/**` | no dedicated skill — list under "not covered by any skill", don't skip silently |

Path-prefix matching only — no LLM judgment call for routing, so re-running
on the same diff always selects the same skills.

## Step 3 — run each matched skill against ONLY the changed files

Scope every skill invocation to the changed file list + diff hunks, not the
whole package (same restriction `code-review` already applies).

## Step 4 — aggregate + report

Sort: CRITICAL → worth-fixing → optional, then file, then line. Verdict line
first: `PASS` or `BLOCKED (N critical findings)`. See plan §6 for the full
terminal-readable report shape (summary block, capped detail, skipped/
generated section, skill-error section).

## Verdict rule

**BLOCKED** iff at least one CRITICAL finding, from any matched skill. No
other threshold. Everything else (worth-fixing/optional) is surfaced but
doesn't block. A skill that errors/times out is reported as `SKILL_ERROR`,
never silently treated as "no findings" — that also forces `BLOCKED (needs
manual review)`, since a crashed reviewer is not evidence of a clean diff.

## Open items (see plan for detail, don't silently resolve differently)

- Hard-gate hook vs advisory convention (plan §1) — unresolved.
- Most current skills are guidance docs, not structured-findings emitters —
  this dispatcher does the translation itself when running them (plan §4).
