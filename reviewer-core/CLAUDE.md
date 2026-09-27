# reviewer-core (@devdigest/reviewer-core) — agent instructions

Pure engine: diff → prompt → LLM → findings. Only `zod` dep, no DB/FS/GitHub
imports — only injected `LLMProvider`. See root `../CLAUDE.md` for repo-wide
stack/conventions — don't duplicate here.

## Read when

- Setup, scripts overview → `README.md`
- Deeper design docs (architecture, ADRs) → `docs/` (doesn't exist yet — create if starting one)
- Test/flow specs → `specs/` (doesn't exist yet — create if adding one)
- Session gotchas, non-obvious facts → `INSIGHTS.md` (doesn't exist yet — auto-created by `engineering-insights` skill on first finding)

## Do not touch

- Purity contract: no DB/FS/GitHub imports here, ever — breaks the pure-engine guarantee both `server` and future agent-runners rely on.
