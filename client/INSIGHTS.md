# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- The PR-list row grid (`GRID` in `pulls/constants.ts`) and its header (`COLUMN_KEYS`, same file) must be edited together and stay index-aligned with `PRRow.tsx`'s children — there's no shared column-definition array driving both, just three separately-maintained lists in sync by convention. `client/src/app/repos/[repoId]/pulls/constants.ts:27`. (2026-09-27)
- Two different `Severity` types exist: `vendor/ui/primitives/tokens.ts` declares a 4-value type including `INFO`, but the canonical shared contract (`vendor/shared/contracts/findings.ts:11`, mirrored server-side) is the 3-value `z.enum(['CRITICAL','WARNING','SUGGESTION'])` with no `INFO` — actual `FindingRecord.severity` values are only the 3. `client/src/vendor/ui/primitives/tokens.ts:3`. (2026-09-27)
- `SeverityBadge`'s `text-transform: uppercase` is CSS-only — the actual label text in the DOM stays title-case (`"Critical"`, not `"CRITICAL"`), so text-matching queries/tests must match the title-case string. `client/src/vendor/ui/primitives/Badge.tsx:75`. (2026-09-27)

## Tool & Library Notes

- `pnpm` in this sandbox was a no-op wrapper (its postinstall never ran, blocked by `allowScripts`) — fixed by running `node install.js` directly in the global pnpm package dir. `pnpm <script>` works normally now; no need for the `npm run` workaround noted earlier. (2026-09-27)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
