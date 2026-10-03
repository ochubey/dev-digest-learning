# Rubric fix plan — 22 failing/partial items

Status: prep work done directly (below), remaining tracks dispatched to
parallel agents (independent file sets, verified before dispatch).

## Done directly (small, cross-cutting, prerequisite for other tracks)

- #4, #5 — `.claude/skills/onion-architecture/SKILL.md`,
  `.claude/skills/pr-self-review/SKILL.md` created from the existing plan docs.
- #6, #44 — `nav.ts`: new `SKILLS LAB` section (Agents, Skills, Conventions),
  `WORKSPACE` now just Pull Requests. `g c` shortcut added.
- #22 (backend half) — `Skill.agent_count` added to the shared contract (both
  vendor copies), computed via a real `agent_skills` group-by count in
  `SkillsRepository.agentCounts()`, wired through `list`/`get`/`update`/
  `setEnabled`. Live-verified via `GET /skills`.
- #43 — API Contract Reviewer agent created live, 4 skills created
  (breaking-change, response-schema, semver-discipline, deprecation-policy,
  each with a directive rule + good/bad example) and linked.
- Schema: `conventions.rejected` boolean added (migration `0011`, applied —
  `accepted=false` alone can't distinguish "pending" from "rejected", and
  rubric #48 requires rejection to survive reload distinctly).
- Dependencies installed: `adm-zip` + `@types/adm-zip` (server, for real zip
  import, #15), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`
  (client, for real drag&drop, #13/#31) — registry was reachable this time,
  unlike the earlier sandbox that built the first pass of this feature.

## Track A — Skills page restructure (client, `client/src/app/skills/**`)

Rebuilds the page to match the rubric's actual shape (current impl is a
functional split-view but doesn't match #9/#10/#11/#25):

- #9 — real CSS grid of skill cards (not the current 290px list column).
- #10 — click a card → **side panel** (Drawer) preview, not the full inline
  editor. Preview = rendered markdown + metadata, matches #26's requirement.
- #25 — a real `/skills/[id]/page.tsx` route with Config/Preview/Versioning
  tabs (currently everything lives inline on `/skills` itself).
- #11, #12 — "Add" → Create/Import choice opens a **modal** (use
  `@devdigest/ui`'s `Modal`), not an inline panel. Form fields: name,
  description, type, body (markdown).
- #22 (client half) — show `agent_count` on the card (`{n} agents` badge,
  data already flows from the backend fix above).
- #23, #24 — Delete button ON the card (not just inside the editor), opens a
  real Modal with confirm/cancel/X (not `window.confirm`).
- #15 — real `.zip` import: server accepts a zip (via `adm-zip`, already
  installed), validates exactly one `.md` at the root (no nested dirs, no
  path-traversal/symlink entries — `adm-zip` entries expose `entryName` and
  `isDirectory`, reject anything with `../` or a directory entry), same
  preview-then-confirm flow as `.md` already has.
- #28, #29 — Versioning tab: "Diff" button (word-level diff against current,
  reuse the diff-rendering approach already used elsewhere in the trace
  drawer if one exists, else a simple two-column red/green line diff) and
  "Restore" button (new endpoint: `POST /skills/:id/versions/:version/restore`
  — sets `skills.body` to that version's body, bumps version, snapshots
  current-before-restore first, same pattern as `update`).

Depends on: nothing outside this file tree except the already-done
`agent_count` contract field. Fully parallel-safe against Track B/C.

## Track B — Agent page fixes (client, `client/src/app/agents/**`)

- #32 — wire `skillCount` prop on `AgentCard` from `AgentsListView` (the prop
  already exists on the component, just isn't passed — needs a per-agent
  linked-skill count; add a lightweight server aggregate or compute
  client-side from a `GET /agents/:id/skills` call per card, whichever is
  cheaper — prefer a batched server endpoint if the list is non-trivial size).
- #33, #34 — swap `window.confirm` for a real Modal (confirm/cancel/X) on the
  agent card's delete button.
- #13, #31 — real drag&drop on the Skills tab reorder (replace the up/down
  arrows) using `@dnd-kit/sortable`, restricted to the linked/enabled subset
  (unlinked skills stay non-draggable, matching current arrow no-op behavior
  but now visually — cursor/handle disabled — not just functionally inert).

Depends on: nothing outside this file tree. Parallel-safe against Track A/C.

## Track C — Conventions feature (new, server + client)

The big one — #38–53 minus #43 (done) and #53 (already passes, confirm live
during this track's verification, no code needed — `FEATURE_MODELS` already
lists `'conventions'` and `SettingsModels.tsx` already renders it generically).

**Already exists, reuse — do not rebuild:**
- `conventions` table (`server/src/db/schema/knowledge.ts`), now with
  `rejected` boolean.
- `repoIntel.getConventionSamples(repoId, n)` — top-N file paths.
- `ConventionCandidate` contract shape already in `knowledge.ts`.
- Feature-model selection plumbing (`resolveFeatureModel(container, ws,
  'conventions')`) — use this for the LLM call's provider/model, not a
  hardcoded one (rubric explicitly calls this out for #53's dynamic-selection
  requirement, which is really about the extraction step actually USING it).

**New server work** (`server/src/modules/conventions/`, mirror the
onion-architecture pattern — repository → service → routes):

- #39 — sample-selection step: read the repo's config files (`.eslintrc*`,
  `tsconfig.json`, `.prettierrc*` — check what actually exists in the cloned
  repo, skip missing ones) + call `getConventionSamples(repoId, 12)` for file
  paths, then read those files' content. Pure I/O, NO LLM call in this step.
- #40 — LLM call: send the samples, get back candidates shaped
  `{category, rule, evidence: {file, line}, confidence}` — Zod-validate the
  response same as other structured LLM calls in this codebase (see
  `reviewer-core`'s pattern for structured completion + retry).
- #38 — `POST /repos/:id/conventions/extract` — runs the above, persists each
  candidate as a `conventions` row (`accepted=false, rejected=false` =
  pending). Must survive reload (already true once persisted to Postgres).
- `GET /repos/:id/conventions` — list all candidates for a repo (pending +
  accepted + rejected, client filters by status for display).
- #47, #48, #49 — `PATCH /conventions/:id` — body `{action: 'accept' |
  'reject' | 'edit', rule?, evidence_path?, evidence_snippet?}`. Reject sets
  `rejected=true` (never re-shown, never folded into the skill). Edit updates
  `rule`/evidence in place, inline, no new endpoint needed beyond this PATCH.
- #45 — `ReScan` is the same extract endpoint, called again — but must not
  duplicate already-processed candidates blindly; simplest correct behavior:
  each scan run is tagged (add a nullable `scan_id`/`created_at`-based
  grouping, or just accept that re-scan adds a fresh batch and the UI shows
  the latest batch by default) — pick the simpler of these during
  implementation, note the choice, don't over-engineer.
- #41, #50, #51, #42 — `POST /repos/:id/conventions/create-skill` — body
  `{name, description, candidate_ids: string[]}` (client sends the
  ACCEPTED ones, possibly after the modal's own edits to name/description/
  body). Server concatenates the given candidates' rules into one skill body,
  creates a `skills` row named `repo-conventions` (or the modal's given name
  if the rubric wants it fixed — #42 says the skill is literally NAMED
  `repo-conventions`, so use that as the default/fixed name, not a free-text
  field, unless the modal's Name field is meant to let you override it —
  implementer's call, lean toward matching #42's literal wording: fixed name
  `repo-conventions`), source `'manual'`, and links it to... which agent?
  Rubric #42 says "прилінкований до агента" without naming one — reasonable
  default: link it to whichever agent(s) the extraction was run in context
  of, or if none is contextually obvious, leave it created-but-unlinked and
  let the user link it from the Skills Lab (simpler, avoids guessing wrong) —
  flag this as an open call for whoever implements it.

**New client work** (`client/src/app/conventions/`):

- #44 — already covered by the nav.ts change above (route `/conventions`
  resolves via the already-existing `activeKeyFor` helper).
- #45 — "Run Scan" / "ReScan" as two distinct buttons (Run Scan shown when no
  candidates exist yet for this repo, ReScan once at least one batch exists).
- #46 — candidate cards: rule, evidence file (+ line if available), confidence
  as a percentage.
- #47 — Accept / Reject / Edit buttons per card.
- #49 — Edit is inline (a card-local textarea/form swap, not a route change
  or modal).
- #48 — Reject removes it from view and it must not reappear on reload
  (backend already guarantees this via the `rejected` flag + a client query
  that filters `rejected=false` for the visible list).
- #50 — "Create skill" button appears once ≥1 candidate is Accepted.
- #51 — Create-skill modal: explains it's building a skill FROM the accepted
  conventions, Name + Description fields, Cancel + Create buttons.
- #52 — after Create, the new skill is visible on the `/skills` page (true
  for free once it's a real `skills` row — no extra client work needed beyond
  the query cache invalidating `["skills"]` on success, same pattern already
  used everywhere else in this codebase).
- Which repo does Conventions operate on? The page needs a repo picker (reuse
  whatever repo-selection UI the Pull Requests page already has) since
  extraction is per-repo (`POST /repos/:id/conventions/extract`).

This track is the largest; if it needs to be split further at implementation
time (server sub-track then client sub-track, sequentially, since client
genuinely depends on the new routes existing), that's expected — unlike
Track A/B this one is NOT fully parallelizable internally.

## Verification (after all tracks land)

- `pnpm typecheck` + full test suite (server + client) — must stay green,
  same pre-existing 6-failure baseline in `indexer-pipeline.test.ts`.
- Re-run the rubric audit live (Docker is up) for every item touched here —
  same rigor as the original audit (live API calls, live DB queries, not just
  reading code), and report the new pass count.
