# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- Two different `Severity` types exist: `vendor/ui/primitives/tokens.ts` declares a 4-value type including `INFO`, but the canonical shared contract (`vendor/shared/contracts/findings.ts:11`, mirrored server-side) is the 3-value `z.enum(['CRITICAL','WARNING','SUGGESTION'])` with no `INFO` — actual `FindingRecord.severity` values are only the 3. `client/src/vendor/ui/primitives/tokens.ts:3`. (2026-09-27)
- `SeverityBadge`'s `text-transform: uppercase` is CSS-only — the actual label text in the DOM stays title-case (`"Critical"`, not `"CRITICAL"`), so text-matching queries/tests must match the title-case string. `client/src/vendor/ui/primitives/Badge.tsx:75`. (2026-09-27)

## Tool & Library Notes

- `pnpm install` silently no-ops in this environment (installed via `npm install -g pnpm`, its own postinstall script is blocked by `allowScripts` restrictions) — it exits 0 with zero output and never creates `node_modules`. Use `npm install` for deps and `npm run <script>` (not `pnpm <script>`) for everything, even though `package.json`/`.npmrc` are pnpm-flavored (hence the harmless "Unknown project config" npm warnings). `client/package.json:1`. (2026-09-27)

## Recurring Errors & Fixes

## Session Notes

## Open Questions
