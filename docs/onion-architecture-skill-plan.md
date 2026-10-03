# Plan: "Onion Architecture" skill (server modules)

Status: PLAN ONLY. No skill written yet.

## 1. Current backend state (verified in repo)

- Fastify 5 + Drizzle (Postgres/pgvector). Modules live under `server/src/modules/<name>/`
  (`routes.ts`, `service.ts`, `repository.ts`, `types.ts` — e.g. `modules/repo-intel/`).
- Adapters already isolated at the edge: `server/src/adapters/{git,github,auth,secrets,llm,embedder,codeindex,depgraph,tokenizer}/`,
  each behind a port interface from `@devdigest/shared` (`GitClient`, `GitHubClient`, `LLMProvider`, …).
- Composition root already exists: `server/src/platform/container.ts` (`Container` class, hand-rolled
  DI, no framework — lazy getters cache adapter instances, `ContainerOverrides` swaps mocks in tests).
  Documented in `server/docs/architecture.md`.
- Verified: no route file currently imports from `adapters/*` directly (`grep` came up empty) — services
  mediate today. So the codebase is already ~70% onion-shaped; gap is enforcement, not architecture.
- Gaps found:
  - No explicit "domain" layer — business rules live inside `service.ts` mixed with orchestration
    (e.g. `repo-intel/service.ts` is 29KB, one file).
  - Nothing stops a future route or domain function from importing an adapter directly — it's a
    convention today, not a rule an automated skill enforces.
  - `Container` getters return concrete adapters typed as interfaces — good — but domain code isn't
    separated from files that import `Container` itself, so "does this file know about infra" isn't
    mechanically checkable yet.

## 2. Sources (Onion / Clean / Hexagonal, Node/TS-relevant)

| Source | What it confirms |
|---|---|
| [Jeffrey Palermo — The Onion Architecture: part 1](https://jeffreypalermo.com/2008/07/the-onion-architecture-part-1/) | Origin of the pattern (2008). Core rule to lift: **all dependencies point inward; the domain model has zero references to infrastructure.** |
| [Programming with Palermo — Onion Architecture Part 4: After Four Years](http://jeffreypalermo.com/blog/onion-architecture-part-4-after-four-years/) | Palermo's own retrospective/clarification of the layers (domain model → domain services → application services → outermost infra/UI). Use for the layer-naming section. |
| [Oliver Drotbohm — Sliced Onion Architecture](http://odrotbohm.github.io/2023/07/sliced-onion-architecture/) | Modern take: combine onion layering with vertical slices per feature — matches this repo's `modules/<feature>/` layout, so the plan should slice onion layers *inside* each module dir, not as repo-wide horizontal folders. |
| [Alistair Cockburn — Hexagonal Architecture (Ports and Adapters), 2005](https://alistair.cockburn.us/hexagonal-architecture/) | Origin of "ports and adapters." Confirms the adapter-at-the-edge rule already in this repo (`adapters/*` implementing `@devdigest/shared` port interfaces) — skill should codify this existing pattern, not invent a new one. |
| [Robert C. Martin — The Clean Architecture (via Clean Coder Blog, referenced from NDepend/Herberto Graça summaries)](https://blog.ndepend.com/onion-architecture-layers/) | The Dependency Rule: source code dependencies can only point inward; outer circles are mechanisms, inner circles are policy. Basis for the "explicit forbidden imports" rule. |
| [tonyfreed/fastify-clean-architecture](https://github.com/tonyfreed/fastify-clean-architecture) | Concrete Fastify + TS example: controllers/routes → use-cases (services) → entities (domain), infra (DB, framework config) as outermost layer. Closest existing OSS precedent to what this repo should enforce. |
| [Remo Jansen (dev.to) — Onion Architecture in Node.js with TypeScript + InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) | Node/TS-specific worked example of DI enforcing onion layering — validates that a hand-rolled container (like this repo's `Container`, no InversifyJS needed) is sufficient; DI is the enforcement mechanism, not a specific library. |

## 3. What the skill must force

Skill scope: `server/src/modules/**` (routes/service/domain split) and `server/src/adapters/**`
(already-correct pattern to preserve). Not client/reviewer-core (reviewer-core is already pure by its
own README rule).

Rules to enforce, in priority order:

1. **Layer dependency direction** (the core Dependency Rule):
   - `domain/*` (new, per-module) — pure business logic/types. Zero imports from `adapters/*`,
     `platform/container.ts`, `db/*`, or any npm package that touches I/O (pg, octokit, simple-git, etc).
   - `service.ts` — orchestration. May import domain + `Container`/port interfaces (typed as interfaces
     from `@devdigest/shared`, never concrete adapter classes).
   - `routes.ts` — Fastify handlers. May call `service.ts` exports only. **Forbidden: importing anything
     from `adapters/*` or `db/*` directly in a `routes.ts` file.**
   - `adapters/*` — implementation of ports. May be imported only from `platform/container.ts`
     (composition root) and adapter unit tests. **Forbidden: importing an adapter from `modules/**`.**

2. **DI-only adapter access**: services must obtain adapters via `container.<x>` (the pattern already
   in `container.ts`), never via a bare `new SomeAdapter()` outside `container.ts`.

3. **No adapter calls skipping service/domain**: a route handler calling `container.git`, `container.github`,
   etc. directly (bypassing `service.ts`) is a violation, even though it's technically still "through
   the container" — the container getter itself isn't a service-layer boundary.

4. **Port interfaces over concrete types** in function signatures — a `service.ts` function parameter
   typed as `OctokitGitHubClient` instead of `GitHubClient` is a violation (defeats testability via
   `ContainerOverrides`).

## 4. Anti-patterns the skill should catch (examples, hypothetical — not present in repo today)

```ts
// BAD — routes.ts importing an adapter directly, skipping service layer
import { SimpleGitClient } from '../../adapters/git/simple-git.js';
app.get('/x', async () => new SimpleGitClient(cfg.cloneDir).clone(...));
```

```ts
// BAD — domain logic reaching into Container/adapters
// domain/scoring.ts
import { Container } from '../../../platform/container.js';
export function scoreFinding(f: Finding, container: Container) { ... }
```

```ts
// BAD — service constructing adapter itself instead of using container getter
// service.ts
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
const gh = new OctokitGitHubClient(token); // should be container.github()
```

```ts
// BAD — concrete adapter type leaking into a service function signature
function indexRepo(git: SimpleGitClient) { ... } // should be GitClient (port)
```

Good pattern to use as the reference example (already in repo): `container.repoIntel` facade —
`run-executor.ts` calls only `getRepoMap`/`getFileRank`/`getCallerSignatures`, never touches the
indexer pipeline directly (per `server/docs/architecture.md`).

## 5. Directory structure to force per module

```
modules/<feature>/
  routes.ts       # Fastify handlers only — parse/validate/call service/serialize
  service.ts       # orchestration — calls domain + container ports
  domain/           # NEW — pure logic, zero I/O imports
    <name>.ts
  repository.ts     # existing pattern (DB access) — stays as-is, is itself a port consumer
  types.ts
```

Existing modules without a `domain/` split (e.g. `repo-intel/service.ts` at 29KB) are flagged as
migration candidates, not required to change immediately — skill should support "new/touched code
must comply" mode before "whole module must comply."

## 6. Open question for skill-creator step (not this plan)

Whether enforcement is static (grep/import-lint check the skill runs on demand or in review) vs.
a `dependency-cruiser` rule (already a repo dependency, used in `adapters/depgraph`) — dependency-cruiser
can express exactly rule 1 as a config rule and is already in the stack, so it's the likely mechanism,
but deciding that belongs to the skill-authoring step.
