# reviewer-core (@devdigest/reviewer-core) — agent instructions

Pure engine: diff → prompt → LLM → findings. Only `zod` dep, no DB/FS/GitHub
imports — only injected `LLMProvider`. See root `../AGENTS.md` for repo-wide
stack/conventions — don't duplicate here.

## Read when

- Setup, scripts overview → `README.md`
- Why the no-DB/FS/GitHub constraint exists → `docs/architecture.md`
- `reviewPullRequest()` input/output contract → `specs/review-contract.md`
- Session gotchas, non-obvious facts → `INSIGHTS.md` (doesn't exist yet — auto-created by `engineering-insights` skill on first finding)

## Do not touch

- Purity contract: no DB/FS/GitHub imports here, ever — breaks the pure-engine guarantee both `server` and future agent-runners rely on.
