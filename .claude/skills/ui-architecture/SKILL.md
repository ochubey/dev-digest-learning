---
name: ui-architecture
description: "UI architecture rules for this repo's Next.js (app router) + React frontend: where pages, colocated vs shared components, constants, utils, business logic, and tests must live, and how server/client components + route handlers split. Use when creating a new page/route, adding or moving a component, deciding where a piece of logic or a constant belongs, or reviewing a frontend PR for structural/placement correctness. Does NOT cover React syntax, hooks correctness, Next.js rendering/caching/performance, or RTL test-writing mechanics — see react-best-practices, next-best-practices, react-testing-library for those."
version: 1.0.0
---

# UI Architecture

Directive placement rules for a Next.js App Router + React frontend. Every rule below is checkable against a file path or import graph — if a rule can't be verified by looking at where something lives, it doesn't belong in this skill.

Scope: architecture and code organization only. Not covered here: component syntax, hook correctness, rendering/caching/performance tuning, test-writing mechanics (see `react-best-practices`, `next-best-practices`, `react-testing-library`).

## 1. Pages and routes (`app/`)

- `app/` holds ONLY routing: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`, and route-group/param folders.
- A `page.tsx`/`route.ts` file must not contain business logic beyond assembling data (via a server call/service function) and composing components. If a route file has a `function` doing real computation inline, that logic is misplaced — move it to `lib/` or `features/`.
- Use `(groupName)` route groups to organize routes or share a layout without affecting the URL. Do not create a route group just to "tidy" folders that don't share a layout.
- Use a leading-underscore `_folder` (e.g. `app/dashboard/_components/`) to hold page-private files inside the route tree — Next.js excludes `_folder` from routing. Any file under an `app/**` subtree that is not itself routable and is not prefixed `_` is a violation.

## 2. Components: colocated vs shared

- **Used by exactly one page/route** → colocate under that route's `_components/` folder (`app/dashboard/_components/RevenueCard/`).
- **Used by 2+ routes/features** → lives in the shared tree: `client/src/components/<ComponentName>/`.
- Never import a component from another feature's `_components/` folder across route boundaries. If two routes need the same component, promote it to shared `components/` — don't import sideways.
- A shared `components/` entry must not import feature-specific state/business logic (e.g. a specific route's server action). Shared components take data/callbacks as props only.

## 3. Naming

- Component directory: kebab-case (`diff-viewer/`, `revenue-card/`). Component file inside it: PascalCase matching the component (`DiffViewer.tsx`), with a barrel `index.ts` re-exporting it.
- Non-component logic files (utils, helpers, hooks): camelCase (`formatCurrency.ts`, `useReviewStatus.ts`).
- One component per file. Small internal-only helper subcomponents may live in the same file only if not exported from the barrel.
- Hooks are named `use*.ts` and live beside the component/feature that owns them, or in a shared `hooks/` if used by 2+ features (same promotion rule as components).

## 4. Constants

- Constants used by a single component/page → colocated `constants.ts` next to that component/page (same dir).
- Constants used across a feature → `<feature>/constants.ts` at the feature root.
- Constants used across the whole app (design tokens, route paths, shared enums mirrored from `@devdigest/shared`) → `client/src/lib/constants.ts` or `client/src/config/`.
- Never inline a magic string/number that appears in 2+ files — it must be promoted to the nearest shared `constants.ts` per the scope rules above.
- Environment-derived config (URLs, flags) is read once in `client/src/lib/env.ts` (or equivalent), never `process.env.X` scattered inline in components.

## 5. Utils vs component body

- A function is a "util" (goes in `utils.ts`/`helpers.ts`) iff it has no dependency on React (no hooks, no JSX, no component state) — pure input→output.
- If a function needs component state, refs, or other hooks, it is not a util — it belongs in a custom hook (`use*.ts`), not inline in the component body and not force-fit into a utils file.
- Utils used by one component → colocated `helpers.ts` beside it. Used by 2+ components → promote to shared `client/src/lib/` or `<feature>/utils.ts` (same promotion rule as components/constants).
- Do not define a named function inside a component body unless it closes over component-local state/props and is under ~10 lines; anything larger is extracted (to a util, if pure, or a hook, if stateful).

## 6. Business logic vs UI layer

- `app/**/page.tsx` and any `components/**` file render UI and call functions — they do not implement domain logic (data transformation rules, validation beyond form-level, orchestration of multiple API calls).
- Domain/business logic lives in one of, by trigger:
  - **Server Component data needs** (read-only, server-only) → a service/query function in `client/src/lib/` or `client/src/features/<feature>/server/`, called from the Server Component. Never fetch-and-transform inline in the page body beyond a single awaited call.
  - **User-triggered mutation from a form/UI action** → a Server Action (`'use server'` function) colocated in `<feature>/actions.ts`.
  - **External/machine caller** (webhook, third-party integration, non-browser client) → a Route Handler at `app/api/<name>/route.ts`. Route Handlers are the only public HTTP surface; UI-triggered mutations use Server Actions instead, not a Route Handler called via `fetch`.
- Server Components own: data fetching, secrets, server-only logic (`import 'server-only'` at the top of any file that must never bundle to the client).
- Client Components (`'use client'`) own: local UI state, event handlers, browser APIs, and hooks with client-only dependencies. A Client Component must not contain a database call, secret read, or `fs`/`node:*` import — that logic belongs in a Server Component or Server Action it calls into.
- A `service/`, `repository/`, or `queries/` layer (if a feature grows one) is domain/data logic; it is imported BY route files and Server Actions, never the reverse.

## 7. Tests

- Colocate: `Component.test.tsx` sits next to `Component.tsx` in the same directory (RTL convention). Do not create a parallel `__tests__/` tree that mirrors `src/` unless the package's existing convention already does so — check the target package first.
- A hook's test (`useThing.test.ts`) sits next to `useThing.ts`.
- A util's test (`helpers.test.ts`) sits next to `helpers.ts`.
- Test files are never colocated across the shared/feature boundary — a shared component's test lives with the shared component, not with the feature that happens to use it.

## Review checklist (for agents reviewing a frontend diff)

For each new/moved file, verify:
1. Is it under `app/**`? If yes, is it a routable file (`page`/`layout`/`route`/etc.) or `_`-prefixed? Anything else is misplaced.
2. Is a component used by only one route but placed in shared `components/`? → flag, should be colocated `_components/`.
3. Is a component used by 2+ routes but colocated in one route's `_components/`? → flag, should be promoted to shared.
4. Does a `'use client'` file import a DB client, secret, or Node built-in? → flag, server-only logic leaking into client.
5. Does a `page.tsx`/Server Action contain multi-step data transformation inline instead of calling a `lib`/`service` function? → flag as misplaced business logic.
6. Is a magic string/number duplicated across 2+ files instead of a shared constant? → flag.
7. Is a test file NOT colocated with its source? → flag.

See [README.md](README.md) for the sourced research behind these rules.
