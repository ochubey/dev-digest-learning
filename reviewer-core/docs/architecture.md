# reviewer-core architecture — the purity contract

`README.md` has the pipeline diagram; this doc is about the one constraint
that makes the whole package work the way it does: **no DB, no filesystem,
no GitHub imports, ever** — only an injected `LLMProvider`.

## Why the constraint exists

Two very different callers consume this package:

- **The server** (`@devdigest/api`), for local "run review in the studio"
  clicks — has a live Postgres connection, a GitHub client, secrets, the
  whole DI container.
- **A future CI runner** (added in L06, "Export to CI") — runs inside a
  GitHub Action, with no database at all, no long-lived process, and a
  different secrets story entirely.

If `reviewer-core` imported `drizzle-orm` or reached into a repo checkout on
disk itself, the CI runner couldn't reuse it without either dragging a
Postgres dependency into every CI run or forking the engine into two
copies that drift. Keeping the engine's only side effect as "call this
injected function to talk to an LLM" means both callers can share the exact
same `assemblePrompt` → `groundFindings` → `Review` pipeline, differing only
in what they pass in and what they do with the output.

## What "injected" means concretely

`LLMProvider` (`@devdigest/shared`) is an interface with one method the
engine calls; `reviewPullRequest` (`review/run.ts`) never constructs a
provider itself. The **server** builds a `LLMProvider` behind `container.llm(id)`
(OpenAI/Anthropic/OpenRouter, resolved from secrets); the engine's own
`OpenRouterProvider` export (`llm/openrouter.ts`) is one **implementation** of
that interface that both the server and the future CI runner can use, but the
engine's core logic (`prompt.ts`, `grounding.ts`, `review/run.ts`) never
imports it directly — only `index.ts` re-exports it as a convenience.

## Enforcing it in practice

There's no lint rule or CI check for this (per root `AGENTS.md`: no
lint/eslint config in the repo) — it's enforced by review discipline and by
this doc existing. The fastest way to violate it by accident: adding a
"just log this to a file for debugging" line, or importing a shared
`db/schema.js` type "just for the type, not the runtime". Both would break
the CI-runner reuse story even though they look harmless in isolation.
