# Spec: pages — data contract per route

`README.md` has the route-map diagram (which endpoints each page calls);
this is the contract — what each page renders and what must stay true when
its data shape changes.

## `/repos/:repoId/pulls` — PR list

- Fetches `GET /repos/:id/pulls` (`usePulls`) → `PrMeta[]`.
- One row (`PRRow`) per PR, columns in this exact order: Pull request ·
  Author · Size · Score · Cost · **Findings** · Status · Updated.
- **Score**: `pr.score` — `null` until the PR has at least one completed
  review (renders `—`). Not a fetch-time computation on the client; the
  server already averages it (see `server/specs/review-flow.md`).
- **Cost**: `pr.cost_usd` via `RunCostBadge` — `null` renders `—`, otherwise
  `$X.XXXX`. Never re-derived client-side from run history.
- **Findings**: `pr.findings` via `FindingsPreviewPopover` — `null`/no items
  renders `—`; otherwise a row of severity-count icons, hover reveals a
  read-only popover ("N FINDINGS IN THIS RUN" + preview list, no
  Accept/Reject — those only exist on the PR detail page).
- Filter chips (All/Needs review/Reviewed/Stale) and the search box filter
  the already-fetched list client-side — no separate query per filter.

## `/repos/:repoId/pulls/:number` — PR detail

Three tabs, one `page.tsx`, tab state in the `?tab` query param:

- **Overview** — PR body only (`OverviewTab`), no extra fetch.
- **Agent runs** (`FindingsTab`) — `usePrReviews` (`GET /pulls/:id/reviews`,
  full findings payload per review, no pagination) + `usePrRuns`/
  `usePrActiveRuns` for the Timeline. One `ReviewRunAccordion` per review,
  newest first, first one open by default. **Each accordion owns its own
  severity-pill filter state** (`useState` local to that component) — there
  is no page-level "filter all runs at once" control; a filter set on one
  run's card never touches another run's card or the aggregate counts shown
  on the PR list.
- **Files changed** (`DiffTab`) — `GET /pulls/:id` file list + patches,
  inline comments via `GET/POST /pulls/:id/comments` (proxied live to
  GitHub, not persisted locally).

Opening a run's trace (`RunTraceDrawer`, via `GET /runs/:id/trace`) is a
drawer overlay, not a route change — `?trace=<runId>` in the query string,
closed by clearing that param.

## `/agents` and `/agents/:id`

List + editor for reviewer agents (`name`, `model`, `system_prompt`,
`strategy`, `repo_intel` toggle, `ci_fail_on` gate). No findings/run data on
these routes — purely agent configuration.

## `/onboarding`

Single "Add a repository" form (`POST /repos`). No submit-time preview of
what the repo contains — the read-only-vs-editable split doesn't apply here
since nothing is displayed yet.

## `/settings/*`

`api-keys` and `models` sections — `GET/PUT /settings`, `POST
/settings/test-connection`. Keys are never round-tripped back to the client
in cleartext after being set (server-side `SecretsProvider`, see
`server/docs/architecture.md`).
