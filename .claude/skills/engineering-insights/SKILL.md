---
name: engineering-insights
description: "Auto-apply at the start (read) and end (append) of any coding task in this repo. At start: read the INSIGHTS.md of whatever package(s) you're about to work in and state its top 3 most relevant entries, before making changes. At end: append short dated, file:line-cited findings under the fitting section (What Works / What Doesn't Work / Codebase Patterns / Tool & Library Notes / Recurring Errors & Fixes / Session Notes / Open Questions) to the INSIGHTS.md of the package that was touched (client/, server/, reviewer-core/, e2e/ — create the file if missing), but only after re-reading it to skip duplicates. Use for non-obvious dependencies, subtle behavior, measured facts (time/cost/tokens), and surprises found while working."
---

# Engineering Insights

Repo is not a monorepo — packages: `client/`, `server/`, `reviewer-core/`, `e2e/`
(see root `AGENTS.md`).

## At the start of a session/task

Before touching files in a package, read `<package>/INSIGHTS.md` if it exists.
Mandatory, not optional. Then state, briefly, the top 3 entries most relevant
to the task at hand (fewer, or none, if the file has fewer or none apply) —
this forces actual processing instead of the file just sitting unread in
context, and is a sanity-check that it was in fact read.

## Sections

`INSIGHTS.md` is split into fixed sections, in this order (create all 7
headers on first creation of the file, even if empty):

1. **What Works** — patterns/approaches confirmed to work in this package.
2. **What Doesn't Work** — approaches tried and rejected, antipatterns.
3. **Codebase Patterns** — non-obvious structure/conventions/behavior of this
   package's own code.
4. **Tool & Library Notes** — gotchas about a dependency, framework, or
   external tool used here.
5. **Recurring Errors & Fixes** — a mistake made more than once and its fix.
6. **Session Notes** — datestamped, one-off findings that don't fit the
   categories above.
7. **Open Questions** — unresolved things worth a future session's attention.

Put each new bullet under the single section it fits best.

## At the end of a task

1. Determine which package(s) had files changed this task.
2. For each, re-read `<package>/INSIGHTS.md` (create if absent, with the 7
   section headers below and nothing else).
3. Append 1-2 sentence bullet(s), under the fitting section, for anything
   non-obvious learned this task — see Sections above for what counts.
4. Do **not** log routine work (ran tests, fixed typo, obvious refactor) — only
   what a future agent wouldn't guess by reading the code alone.
5. Skip entirely if the task had no genuine finding — don't force an entry.
6. Before appending, check the finding isn't already recorded anywhere in the
   file (same fact, maybe different wording) — if it's already there, don't
   write a duplicate.
7. **Append-only, never overwrite.** Add the bullet under its section with an
   edit anchored on existing content in that section (or on the section
   header, if the section is still empty) — never rewrite the whole file.
   Never use `Write` (or any full-file rewrite) on an existing `INSIGHTS.md` —
   that replaces the whole file and destroys prior entries. `Write` is only
   for the one-time creation of a missing file with the 7 empty section
   headers.
8. **Cap ~200 entries total per file.** If a file is at or near that size,
   flag it in your response to the user instead of silently continuing to
   grow it — pruning stale/duplicate/no-longer-relevant entries is a monthly
   human-reviewed pass, not something this skill does unattended.

## Entry format

```
- <finding, 1-2 sentences>. `path/to/file.ts:123`. (YYYY-MM-DD)
```

Line number is the concrete anchor for the finding, not just the file it's in.
Date is the date the task ran (ask system context / environment for today's date if unsure).

## Example

```
# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- `pnpm db:migrate` does NOT run on server boot — first-run 500s are almost always missing migrations, not a real bug. `server/src/server.ts:1`. (2026-09-27)

## Tool & Library Notes

- `app.log.debug` calls are silent by default in dev — `config.logLevel` (from `.env`) must be `debug` or lower to see them; `pino-pretty` transport only kicks in for `nodeEnv === 'development'`. `server/src/app.ts:50-59`. (2026-09-27)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
```
