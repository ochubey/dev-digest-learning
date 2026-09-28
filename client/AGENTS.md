# client (@devdigest/web) — agent instructions

Next.js 15 App Router, port 3000. See root `../AGENTS.md` for repo-wide stack/conventions —
don't duplicate here.

## Read when

- Setup, scripts overview → `README.md`
- Component boundary/data-layer conventions → `docs/ui-architecture.md`
- Per-page data contract → `specs/pages.md`
- Session gotchas, non-obvious facts → `INSIGHTS.md`

## Do not touch

- `next-env.d.ts` — Next.js-generated.
- `src/vendor/*` — vendored shared copies, read-only unless task is explicitly about updating them.
