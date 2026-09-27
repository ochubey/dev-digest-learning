# Server architecture — DI container & adapter ports

This is the part `README.md`'s request-flow diagram doesn't zoom into: how
`platform/container.ts` wires the app together, and why every external
dependency (LLM, GitHub, git, secrets, tokenizer, price book) is an
interface, not a concrete class.

## The container is the composition root

`Container` (`src/platform/container.ts`) is constructed once per app
instance, in `src/app.ts`, and threaded through every Fastify route handler
as `app.container`. It holds:

- **Eager singletons**: `config`, `db`, `secrets`, `auth`, `jobs` (the
  `JobRunner`), `runBus` (the SSE event bus) — built in the constructor,
  always present.
- **Lazy getters**: `git`, `github`, `codeIndex`, `embedder`, `priceBook`,
  `agentsRepo`, `reviewRepo`, `repoIntel`, `depgraph`, `tokenizer` — each is a
  private `_x?` field plus a `get x()` that constructs on first access and
  caches the instance (`this._x ??= new ...`). A route handler that never
  touches `container.github` never pays for constructing an Octokit client or
  looking up `GITHUB_TOKEN`.
- **`llm(id)`**: not a lazy getter but an async method with its own
  `llmCache: Map<string, LLMProvider>`, because building an LLM provider needs
  an `await this.secrets.get(...)` — providers are looked up by id
  (`'openai' | 'anthropic' | 'openrouter'`) and cached after first build.

## Ports, not classes

Every adapter is typed by an interface from `@devdigest/shared`
(`GitClient`, `GitHubClient`, `CodeIndex`, `Embedder`, `LLMProvider`,
`SecretsProvider`, `AuthProvider`) — the concrete implementation
(`SimpleGitClient`, `OctokitGitHubClient`, `RipgrepCodeIndex`,
`OpenAIEmbedder`, `OpenAIProvider`/`AnthropicProvider`/`OpenRouterProvider`,
`LocalSecretsProvider`, `LocalNoAuthProvider`) is an implementation detail of
the getter. Services (e.g. `ReviewService`, `ReviewRunExecutor`) depend on
`container.git`/`container.github`/etc., never on the adapter class
directly.

`ContainerOverrides` (same file) is how tests swap any of these for a mock —
construct a `Container` with `{ git: mockGitClient, llm: { openai: mockLLM } }`
and every consumer downstream gets the mock without a single `vi.mock(...)`
call. `src/adapters/mocks.ts` holds the ready-made mocks used by the
integration test harness (`test/helpers/pg.ts`).

## Cost attribution: `PriceBook`

`container.priceBook` (`src/platform/price-book.ts`) wraps a live OpenRouter
`/models` pricing fetch (6h TTL cache) with a static fallback table
(`src/adapters/llm/pricing.ts`'s `estimateCost`) for OpenAI/Anthropic or when
the OpenRouter fetch is cold/unavailable. `estimate(model, tokensIn,
tokensOut)` is **synchronous** (safe to call with no `await`) — it's injected
into `OpenRouterProvider` (via `buildLlm('openrouter')`) as a per-call cost
fallback, and into `OpenAIProvider`/`AnthropicProvider` calls directly; either
way, the resulting `costUsd` flows back through `reviewer-core`'s
`ReviewOutcome.costUsd` (see `reviewer-core/specs/review-contract.md`) —
`run-executor.ts` reads that field rather than calling `priceBook.estimate`
itself.

## repo-intel is its own bounded module

`modules/repo-intel/` has its own README with a pipeline diagram
(clone/fetch → walk → ast-grep → import graph → PageRank rank → repo map,
all persisted to Postgres) — this doc doesn't repeat it. The one fact worth
adding here: `container.repoIntel` is a **facade** (`RepoIntelService`), and
`run-executor.ts` only calls the facade's `getRepoMap`/`getFileRank`/
`getCallerSignatures` — it never touches the indexer pipeline directly. An
unindexed repo makes the facade return empty results, not throw, so a review
still runs (diff-only) against a repo that hasn't finished indexing yet.
