# Feature specs

One spec per feature or cohesive behavior change, written by `spec-creator`, named `NN-<feature>.md` (`SPEC-NN`). Spec-anchored: update the same file when behavior changes; use `Supersedes:` when a new spec partly replaces an old decision.

- `specs/` = behavior we build or maintain. `docs/` = architecture, ADRs, contracts. `insights/` = raw agent observations, curated by a human into `docs/` or `AGENTS.md`.
- Status: `draft` -> `approved` (human) -> `implemented`.
- Plans live in `docs/plans/`.
- `eval-pipeline.md` is a symlink to `03-eval-pipeline.md`: the L06 homework checklist names `specs/eval-pipeline.md`; the numbered file stays the source of truth.
- `multi-agent-review.md` and `export-to-ci.md` are symlinks to `04-multi-agent-review.md` and `05-export-to-ci.md`: the L07 lab names them without numbers; the numbered files stay the source of truth.
