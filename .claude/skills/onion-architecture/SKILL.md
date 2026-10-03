---
name: onion-architecture
description: Layering rules for DevDigest's server modules — route → service → domain, dependencies point inward, adapters live at the edge behind ports and are wired only through the DI container. Use when creating/reviewing a server route, service, or adapter, or deciding where new backend logic belongs.
---

# Onion Architecture (server/src/modules/**)

Adapted for this repo from Palermo's Onion Architecture and Cockburn's
Ports & Adapters — see `docs/onion-architecture-skill-plan.md` for the full
sourced research. This skill is the enforceable rule set derived from it.

## Layers, outer → inner

1. **`routes.ts`** — Fastify handlers only. Parse/validate the request, call
   exactly one `service.ts` method, serialize the response. No business logic,
   no direct DB access, no adapter calls.
2. **`service.ts`** — orchestration. Depends on `Container` (typed port
   interfaces from `@devdigest/shared`: `GitClient`, `GitHubClient`,
   `LLMProvider`, etc.), never on a concrete adapter class. Calls domain logic
   + repository/adapters as needed.
3. **`domain/`** (where a module has one) — pure business rules. Zero imports
   from `adapters/*`, `platform/container.ts`, `db/*`, or any I/O-touching
   package.
4. **`adapters/*`** — implementations of the port interfaces (`SimpleGitClient`,
   `OctokitGitHubClient`, `OpenAIProvider`, …). Imported ONLY from
   `platform/container.ts` (the composition root) and adapter unit tests.

## Hard rules (violations to flag in review)

- A `routes.ts` file must not import from `adapters/*` or `db/*` directly —
  it must go through `service.ts`.
- A `service.ts` must not construct an adapter itself (`new SomeAdapter(...)`)
  — it must use a `container.<x>` getter (see `platform/container.ts`).
- A route handler calling `container.git`/`container.github`/etc. directly,
  bypassing `service.ts`, is a violation even though it goes through the
  container — the container getter is not a service-layer boundary.
- A `service.ts` function signature must use the port interface type
  (`GitHubClient`), never the concrete adapter class (`OctokitGitHubClient`) —
  this is what keeps `ContainerOverrides` mockable in tests.
- `adapters/*` must never be imported from `modules/**`.

## Reference implementation

`container.repoIntel` (`platform/container.ts`) is the pattern to copy: it's
a facade (`RepoIntelService`) that higher-level code (`run-executor.ts`) calls
through `getRepoMap`/`getFileRank`/`getCallerSignatures` — callers never touch
the indexer pipeline directly.

## Known gap (not yet fixed, don't re-flag as new)

No module currently has a `domain/` directory — business logic and
orchestration are combined in `service.ts`. This is a tracked structural gap,
not something every review needs to re-surface; flag it only if you're
already touching a large `service.ts` and a domain split would clearly help.

## Anti-patterns to catch

```ts
// BAD — routes.ts importing an adapter directly, skipping the service layer
import { SimpleGitClient } from '../../adapters/git/simple-git.js';
app.get('/x', async () => new SimpleGitClient(cfg.cloneDir).clone(...));
```

```ts
// BAD — service constructing an adapter itself
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
const gh = new OctokitGitHubClient(token); // should be: await container.github()
```

```ts
// BAD — concrete adapter type leaking into a service function signature
function indexRepo(git: SimpleGitClient) { ... } // should be: git: GitClient
```
