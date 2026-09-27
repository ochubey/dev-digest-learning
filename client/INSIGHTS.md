# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- The PR-list row grid (`GRID` in `pulls/constants.ts`) and its header (`COLUMN_KEYS`, same file) must be edited together and stay index-aligned with `PRRow.tsx`'s children — there's no shared column-definition array driving both, just three separately-maintained lists in sync by convention. `client/src/app/repos/[repoId]/pulls/constants.ts:27`. (2026-09-27)

## Tool & Library Notes

- `pnpm` in this sandbox was a no-op wrapper (its postinstall never ran, blocked by `allowScripts`) — fixed by running `node install.js` directly in the global pnpm package dir. `pnpm <script>` works normally now; no need for the `npm run` workaround noted earlier. (2026-09-27)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
