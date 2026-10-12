# Insights

## What Works

## What Doesn't Work

## Codebase Patterns

## Tool & Library Notes

- The flow DSL has no "assert element/text absent" primitive — only positive assertions (`wait --text`, `wait --url`, `find role|text|label`). Absence can only be proven indirectly (e.g. toggling a filter off and re-asserting the previously-hidden text reappears), not directly. `e2e/README.md:32`. (2026-09-27)

- `agent-browser find text "…" click` did not reliably toggle a collapsible section (the click was swallowed and the next `wait --text` timed out after 60 s); a direct DOM click via `eval` (`[...document.querySelectorAll('span')].find(…).click()`) is deterministic. `e2e/specs/10-trace-project-context.flow.json:16`. (2026-10-10)
- Running flows locally needs, once: `npm i -g agent-browser && agent-browser install`, then `cd e2e && npm ci` (without it the runner fails with `sh: tsx: command not found`); macOS has no `timeout` command. `AGENT_BROWSER_HEADED=1 ./scripts/e2e.sh` shows the browser window. `e2e/README.md:52`. (2026-10-10)

- 2026-10-11: `agent-browser screenshot` with a relative path fails inside a flow because `run.ts` clears `e2e/test-results` before each run; use an absolute path and do not commit screenshot steps into flows. `agent-browser set viewport <w> <h>` makes tall dialogs fit in one frame.

## Recurring Errors & Fixes

- Flows 09–11 need the fixture documents (`PROJECT_DOCS_SOURCE=fixture`): `scripts/e2e.sh:44` exports it, but `.github/workflows/e2e-web.yml` must carry the same `env:` line. It was left out of PR #18 because the `gh` token had no `workflow` scope (GitHub rejects pushes that touch workflow files); until it is added in the workflow, flow 09 has no documents in CI. (2026-10-10)

- 2026-10-11: `scripts/e2e.sh` starts its own `next dev -p 3100` inside `client/`, i.e. in the SAME `client/.next` as a developer's running `next dev` on :3000. After an e2e run the dev web kept serving chunks compiled with `NEXT_PUBLIC_API_BASE=http://localhost:3101` ("Cannot reach the DevDigest engine at http://localhost:3101", repos list empty). Fix: stop the dev web, `rm -rf client/.next`, restart `pnpm dev`. Either stop the dev web before running `./scripts/e2e.sh`, or give the e2e web its own `distDir` (follow-up, not done).
- 2026-10-11: the global rate limit (120 requests per minute per IP) is exceeded by one browser running flows 01-13 (the Evals pages fan out several requests); symptom is a flow failing on a page-load `wait --text` with `Rate limit exceeded` in the API log. `scripts/e2e.sh` now exports `RATE_LIMIT_MAX=5000`; the CI workflow needs the same env line (and `PROJECT_DOCS_SOURCE=fixture`).

## Session Notes

## Open Questions
