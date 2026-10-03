# Client UI architecture — component boundaries & conventions

`README.md` has the route map; this is the part it doesn't cover — how a
page is actually put together and where the Server/Client boundary sits.

## Server/Client Component boundary

App Router pages (`src/app/**/page.tsx`) are Server Components by default,
but this app's pages are almost all interactive (filters, live SSE runs,
mutations) — so in practice `"use client"` sits at the **page** level for
every route that needs `useState`/hooks/TanStack Query directly (e.g.
`app/repos/[repoId]/pulls/page.tsx`, `.../pulls/[number]/page.tsx`), and
every leaf component under its `_components/` folder inherits client-side
rendering transitively. There is currently no server-rendered data-fetching
in this app — all data comes from TanStack Query hooks running client-side
against the Fastify API. A future page that's genuinely static/SSR-only
would be the first to break this pattern; there's no established convention
for mixing the two yet.

## `_components/` colocation

Feature logic lives next to the page that owns it, in
`app/<route>/_components/<ComponentName>/`, never in a shared top-level
components folder unless it's used by 2+ unrelated routes (those go in
`src/components/<name>/`, e.g. `run-cost-badge`, `popover`, `app-shell`).
Each component folder: `Component.tsx` (PascalCase, matches folder name),
`index.ts` (barrel, re-exports the component as both named and `default`),
colocated `constants.ts`/`helpers.ts`/`styles.ts` as needed, and a
`Component.test.tsx` next to it (not in a separate `__tests__/`). The `_`
prefix on `_components` opts the folder out of Next's route-segment
resolution — it's a plain directory, not a route.

## Data layer: `lib/hooks/*`

Every network call goes through a TanStack Query hook in `src/lib/hooks/`,
never a raw `fetch` inside a component. Hooks are grouped by domain file
(`reviews.ts`, `core.ts`, …), each wrapping `src/lib/api.ts`'s thin
`api.get`/`api.post`/etc, and typed against `src/lib/types.ts`'s re-exports
of `@devdigest/shared` contracts. Mutations that affect a run/review
invalidate the relevant query keys (`["pr-active-runs", prId]`,
`["pr-runs", prId]`, `["reviews", prId]`) rather than manually patching
cached data — see `page.tsx`'s `invalidateActiveRuns`/`invalidateRunHistory`
for the pattern.

## The `@devdigest/ui` boundary (`src/vendor/ui`)

Everything under `src/vendor/ui` and `src/vendor/shared` is a **vendored
copy** (per root `AGENTS.md`'s do-not-touch list) — treated as a read-only
external design-system package, not app code. New app-specific UI (anything
that isn't a generic, reusable-across-any-DevDigest-screen primitive) goes
in `src/components/<name>/` instead, even if it looks similar to something
in the vendor kit (e.g. `Popover` in `src/components/popover/` rather than
extending `vendor/ui/kit/Dropdown.tsx`, because the vendor folder is meant
to stay in sync with an external source, not accumulate one-off additions).
