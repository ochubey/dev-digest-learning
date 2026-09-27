# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

- `reviews` denormalizes `run_id` (nullable uuid, no FK) onto itself at insert time — the PR-list "latest review" join can pull a per-run field (e.g. `agent_runs.cost_usd`) by `leftJoin(agentRuns, eq(agentRuns.id, reviews.runId))` instead of a second round-trip. `server/src/db/schema/reviews.ts:19`. (2026-09-27)
- `container.priceBook.estimate(model, tokensIn, tokensOut)` is synchronous (returns `number | null` directly, not a Promise) — safe to call inline in `run-executor.ts` right after token counts are known, no `await` needed. `server/src/platform/price-book.ts:33`. (2026-09-27)

## Tool & Library Notes

- `app.log.debug` calls are silent by default in dev — `config.logLevel` (from `.env`) must be `debug` or lower to see them; `pino-pretty` transport only kicks in for `nodeEnv === 'development'`. `server/src/app.ts:50-59`. (2026-09-27)
- `pnpm` installed via `npm install -g pnpm` is a no-op wrapper shell script in this sandbox until its own postinstall (`install.js`, which downloads the real native binary) is allowed to run — `allowScripts` blocks it silently (exit 0, zero output, looks like success). Running `node install.js` directly from the global pnpm package dir (`npm root -g`/pnpm/install.js) fixes it in-place; after that `pnpm <script>` works normally (no need to keep using `npm run` as a workaround). `server/package.json:1`. (2026-09-27)

## Recurring Errors & Fixes

- `pnpm db:migrate` / `pnpm db:seed` silently do NOTHING on Windows (exit 0, no output, no DB changes) — both `migrate.ts:35` and `seed.ts:227` gate their CLI entrypoint on `import.meta.url === \`file://${process.argv[1]}\``, but on Windows `process.argv[1]` is a backslash path (`E:\...`) while `import.meta.url` is a `file:///E:/...` URL — they never match, so the guarded block never runs. Workaround: write a one-off script that imports `runMigrations`/`seed` directly and calls them, instead of running the file as a CLI entrypoint. `server/src/db/migrate.ts:35`, `server/src/db/seed.ts:227`. (2026-09-27)

## Session Notes

- Seeded agents default to `deepseek/deepseek-v4-flash` via OpenRouter — this is a reasoning model (hidden `reasoning`/`reasoning_details` tokens billed as `completion_tokens` before any visible `content`). A real single-pass review of a 3-file/~70-line diff took 16s and 1028 completion tokens (`$0.00105`) end-to-end — noticeably slower than a plain non-reasoning flash model would be, and can look like a hang if you expect sub-5s responses; give runs 30s+ before assuming something's stuck. `server/src/adapters/llm/pricing.ts:1`. (2026-09-27)

## Open Questions
