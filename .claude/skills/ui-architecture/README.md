# ui-architecture — sources

Research backing the rules in [SKILL.md](SKILL.md). Grouped by the question each source answers. All URLs verified live via WebSearch/WebFetch during research (2026-09).

## Pages / app-router structure

- [Next.js: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) — official docs. `app/` route segment conventions (`page.js`, `layout.js`, folder-per-route), route groups `(groupName)`, private `_folder` convention.
- [Next.js: Routing Colocation](https://nextjs.org/docs/app/building-your-application/routing/colocation) — official. Only `page`/`route` files are routable inside a route segment; everything else in that folder is safe to colocate. `_folder` prefix opts a folder out of routing entirely.

## Colocated vs shared components

- [bulletproof-react: project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — widely-cited community architecture reference. `src/components` (shared) vs `src/features/*` (feature/page-specific) split.
- [bulletproof-react: project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md) — enforceable rule backing the split above: no cross-feature imports.

## Naming

- [Airbnb React/JSX Style Guide](https://github.com/airbnb/javascript/tree/master/react) — PascalCase component files, filename matches component name, `index.jsx` for a directory's root component; camelCase for non-JSX logic files.

## Constants

- [Next.js: Project Structure](https://nextjs.org/docs/app/getting-started/project-structure) — official; `lib`/`config` are unopinionated placeholder folders, no framework-mandated constants location.
- [Next.js: Environment Variables guide](https://nextjs.org/docs/app/guides/environment-variables) — official pattern for env-derived config, distinct from static app constants.

## Utils/helpers vs component body

- [bulletproof-react: project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md) — shared `utils`/`hooks` at repo root, feature-local logic stays inside the feature folder.
- [Felix Gerschau: Separation of Concerns with React Hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) — framework-agnostic logic → plain functions/utils; framework-coupled (stateful) logic → hooks.

## Business logic vs UI layer (React, general)

- [Patterns.dev: Container/Presentational Pattern](https://www.patterns.dev/react/presentational-container-pattern/) — canonical pattern reference; modern React favors custom hooks over container components for this split.
- [Felix Gerschau: Separation of Concerns with React Hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/) — practical rule for hook vs plain-module placement.
- [Martin Buchalik: The Controller Pattern](https://medium.com/@MBuchalik/the-controller-pattern-separate-business-logic-from-presentation-in-react-331f72fcb32a) — `useController()` hook holds business logic, component stays purely presentational.

## Server vs Client Components — where logic lives

- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — official. Server Components own data fetching/secrets/server-only logic; Client Components own state/event handlers/browser APIs/custom hooks. Documents `server-only`/`client-only` packages to prevent logic leaking across the boundary.

## Route handlers vs Server Actions

- [Nuwan Thuduwage: Route Handlers vs Server Actions](https://medium.com/@nuwan.thuduwage/route-handlers-vs-server-actions-the-old-way-vs-the-modern-way-in-next-js-a78d2300bb48) — rule of thumb: human-triggered UI mutation → Server Action; machine/external caller (webhook, third-party, mobile) → Route Handler in `app/api/.../route.ts`.
- [Makerkit: Server Actions vs Route Handlers](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers) — same distinction from a production-oriented source; reinforces Route Handlers as the public-API surface.

## Business logic placement in a Next.js project

- [Feature-Sliced Design: The Ultimate Next.js App Router Architecture](https://feature-sliced.design/blog/nextjs-app-router-guide) — core rule: "Routes should assemble features and widgets, not implement domain logic." Business logic lives in `features`/`entities` layers, not scattered across `app/`, `components/`, or `utils/`.
- [GitHub Discussion: Next.js Modular and Scalable Project Structure](https://github.com/orgs/community/discussions/190342) — community-endorsed pattern: `app/` strictly for routing; business logic in a `features/` dir organized by domain; layered `service/` (domain logic) / `repository/` (DB access) / `handler/` (server entry points) split.

## Test location

- [testing-library/react-testing-library (GitHub)](https://github.com/testing-library/react-testing-library) — official RTL repo/docs, canonical tool reference.
- [Kent C. Dodds: Introducing react-testing-library](https://kentcdodds.com/blog/introducing-the-react-testing-library) — original author's rationale; RTL philosophy underlies colocation-friendly testing (`Component.test.tsx` next to `Component.tsx`).

## Known gap

No official Next.js doc mandates a service/repository/data-layer pattern — the framework is unopinionated on business-logic placement beyond the Server/Client Component boundary. Rule 6 in SKILL.md is sourced from community consensus (Feature-Sliced Design, the GitHub discussion above), not an official Next.js recommendation.
