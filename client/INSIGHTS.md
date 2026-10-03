# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- The PR-list row grid (`GRID` in `pulls/constants.ts`) and its header (`COLUMN_KEYS`, same file) must be edited together and stay index-aligned with `PRRow.tsx`'s children — there's no shared column-definition array driving both, just three separately-maintained lists in sync by convention. `client/src/app/repos/[repoId]/pulls/constants.ts:27`. (2026-09-27)
- Two different `Severity` types exist: `vendor/ui/primitives/tokens.ts` declares a 4-value type including `INFO`, but the canonical shared contract (`vendor/shared/contracts/findings.ts:11`, mirrored server-side) is the 3-value `z.enum(['CRITICAL','WARNING','SUGGESTION'])` with no `INFO` — actual `FindingRecord.severity` values are only the 3. `client/src/vendor/ui/primitives/tokens.ts:3`. (2026-09-27)
- `SeverityBadge`'s `text-transform: uppercase` is CSS-only — the actual label text in the DOM stays title-case (`"Critical"`, not `"CRITICAL"`), so text-matching queries/tests must match the title-case string. `client/src/vendor/ui/primitives/Badge.tsx:75`. (2026-09-27)
- `SeverityBadge` takes `severity`+`count` directly (no `FindingRecord[]` needed) — usable anywhere a denormalized `{critical,warning,suggestion}` tally exists (e.g. `RunSummary.severity_counts`) without fetching the full findings array just to render the icons. `client/src/vendor/ui/primitives/Badge.tsx:52`. (2026-09-28)

- SUPERSEDED 2026-09-28: `@dnd-kit/core`+`sortable`+`utilities` are now installed, and `SkillsTab` was rewired to real drag&drop (`useSortable` per row, disabled for unlinked skills, `DndContext`/`SortableContext` wrapping the full visible list so drag indices stay consistent even though only linked rows are draggable). Same `POST /agents/:id/skills` mutation shape as before.
- `@dnd-kit/sortable`'s `useSortable({ id, disabled })` still needs `setNodeRef` on the row for correct positioning even when `disabled: true` — only the `attributes`/`listeners` spread (which enables pointer/keyboard drag start) should be conditionally omitted to make a row visually/functionally non-draggable; `disabled` alone still lets dnd-kit apply CSS.Transform reflow during a *different* row's drag, which is desired (unlinked rows should shift out of the way, not just refuse to be picked up). `client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx:139`. (2026-09-28)
- `useDeleteAgent()`'s `mutate` accepts a second-arg options object per-call (standard TanStack Query) — used to close the confirm Modal only `onSuccess`, so a failed delete leaves the modal open with the error state implicit in `del.isPending` going back to false. `client/src/app/agents/_components/AgentCard/AgentCard.tsx:1`. (2026-09-28)

- `messages/en/skills.json` (pre-existing, unused before this task) documents a different, out-of-scope Skills Lab design (community search, URL import, "untrusted source"/vetting workflow) that doesn't match the actual `Skill` Zod contract (no vetting/trust field) — the `/skills` page built for the in-scope spec (Config/Preview/Versions tabs, file-only import) does NOT use this namespace's keys; inline English strings were used instead to avoid shipping misleading copy. `client/messages/en/skills.json:1`. (2026-09-28)

## Tool & Library Notes

- `@devdigest/ui`'s `Markdown` component (`vendor/ui/primitives/Markdown.tsx`) is react-markdown + remark-gfm with no `rehype-raw` plugin registered and no `dangerouslySetInnerHTML` — it never renders raw HTML, so it satisfies a "no raw HTML in markdown preview" security requirement out of the box; reuse it instead of hand-rolling a markdown parser for previews. `client/src/vendor/ui/primitives/Markdown.tsx:10`. (2026-09-28)
- `pnpm` in this sandbox was a no-op wrapper (its postinstall never ran, blocked by `allowScripts`) — fixed by running `node install.js` directly in the global pnpm package dir. `pnpm <script>` works normally now; no need for the `npm run` workaround noted earlier. (2026-09-27)

## Recurring Errors & Fixes

- The `Agent` and `Skill` Zod contracts each have TWO physical copies (`server/src/vendor/shared/contracts/knowledge.ts` and `client/src/vendor/shared/contracts/knowledge.ts`) that must be edited in lockstep — adding a required field (e.g. `skill_count`) to one without the other silently breaks `pnpm typecheck` only on the side you forgot, with a confusing "missing property" error pointing at unrelated test files that build object literals against the type. `client/src/vendor/shared/contracts/knowledge.ts:227`, `server/src/vendor/shared/contracts/knowledge.ts:233`. (2026-09-28)

## Session Notes

- Track A rubric-fix rebuilt `/skills` as a real CSS grid (`SkillsView`'s `s.grid` — `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`), replacing the old 290px list-column layout. Card click now opens a `Drawer` PREVIEW (`SkillPreviewDrawer` — rendered markdown + metadata, "Open" button routes to `/skills/[id]`), not the full inline editor; the full Config/Preview/Versioning editor now lives at a real `/skills/[id]/page.tsx` route with `?tab=` state, same controlled-tab pattern as `AgentEditorPage` — `SkillEditor` was extended with optional `tab`/`onTab` props (falls back to local state when omitted, e.g. if ever embedded elsewhere uncontrolled). `client/src/app/skills/_components/SkillsView/SkillsView.tsx:1`, `client/src/app/skills/[id]/page.tsx:1`. (2026-09-28)
- The design mock's word-level diff algorithm (`diffTokens` in `tmp/Dev Digest/screen_skills.jsx`'s `RunCompare`) is a straightforward LCS-on-whitespace-split-tokens diff — ported the algorithm as-is (not the mock's `React.createElement` styling) into `client/src/app/skills/_components/SkillEditor/_components/VersionsTab/helpers.ts` for the Versions tab's new Diff button (`DiffModal`), comparing a version snapshot's body against the skill's CURRENT body. `client/src/app/skills/_components/SkillEditor/_components/VersionsTab/helpers.ts:1`. (2026-09-28)
- `@devdigest/ui`'s icon registry (`vendor/ui/icons.tsx`) has NO `GitCompare` or `RotateCcw` — used `GitCommit` (Diff button) and `RefreshCw` (Restore button) as the closest available icons instead of adding new lucide-react imports to the vendored (read-only) file. `client/src/vendor/ui/icons.tsx:1`. (2026-09-28)

- `/conventions` has no `:repoId` in its `nav.ts` href (unlike `/repos/:repoId/pulls`), so it needs its own in-page repo picker; reused `useActiveRepo()` (the same repos list `RepoSwitcher` shows) but kept the selection as page-local state rather than calling `setRepoId`/navigating — the sidebar's repo stays untouched while browsing conventions for a different repo. `client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx:1`. (2026-09-28)

## Open Questions
