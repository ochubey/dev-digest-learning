# client (@devdigest/web) — agent instructions

Next.js 15 App Router, port 3000. See root `../CLAUDE.md` for repo-wide stack/conventions —
don't duplicate here.

## Read when

- Setup, scripts overview → `README.md`
- Deeper design docs (architecture, ADRs) → `docs/` (doesn't exist yet — create if starting one)
- Test/flow specs → `specs/` (doesn't exist yet — create if adding one)
- Session gotchas, non-obvious facts → `INSIGHTS.md` (doesn't exist yet — auto-created by `engineering-insights` skill on first finding)

## Do not touch

- `next-env.d.ts` — Next.js-generated.
- `src/vendor/*` — vendored shared copies, read-only unless task is explicitly about updating them.
