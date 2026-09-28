# Implementation plan: Skills feature

Status: PLAN — no code written yet. Small-steps style (one module/file at a time,
typecheck + tests after each step, no behavior-breaking combined with structure
changes), matching how the earlier server onion-architecture refactor was run.

## 0. What already exists (do NOT rebuild)

Checked against `docs/DevDigest Design (standalone).html`'s `screen_skills.jsx` /
`screen_agents.jsx` / `screen_trace.jsx` mocks and the current codebase:

- **DB schema** — `server/src/db/schema/skills.ts` (`skills`, `skill_versions`),
  `server/src/db/schema/agents.ts` (`agent_skills` link table). Done.
- **Contracts** — `Skill`, `SkillType`, `SkillSource`, `AgentSkillLink`,
  `CommunitySkill`, `PluginSkill`/`PluginBundle` (import/export) in
  `vendor/shared/contracts/{knowledge,productionize}.ts`. Done (source enum needs
  one addition, §1).
- **Agent↔skill linking (req #2, server side)** — fully implemented:
  `modules/agents/repository.ts` (`linkedSkills`, `linkSkill`, `unlinkSkill`,
  `setSkills`), `service.ts` (`skillLinks`, `setSkills`, `linkSkill`), `routes.ts`
  (`GET/POST /agents/:id/skills`). **Nothing to build here.**
- **Prompt assembly engine (req #2/#3 core)** — `reviewer-core/src/prompt.ts`
  already has `PromptParts.skills?: string[]`, joins them under `## Skills / rules`,
  and records the joined block in `PromptAssembly.skills` for the trace. **The
  assembly mechanism is done** — only the wiring that feeds it real skill bodies
  is missing (§3).
- **What's actually missing**: a skills-entity CRUD module (server), the
  run-executor wiring that turns "agent's linked skills" into `PromptParts.skills`
  + per-skill token counts, an import endpoint, and 100% of the client UI (agent
  editor currently ships Config tab only — see `AgentEditor.tsx:2` comment
  "lessons add Skills/Evals/Stats/CI tabs; the Part-0 starter ships Config only").

## 1. Schema change — SkillSource enum

- `server/src/db/schema/skills.ts`: add `'imported_file'` to the `source` enum
  (`['manual', 'imported_url', 'extracted', 'community', 'imported_file']`).
- `vendor/shared/contracts/knowledge.ts`: same addition to `SkillSource` Zod enum.
  This file is vendored/read-only per CLAUDE.md **except when the task is
  explicitly about updating the shared contract** — this qualifies; update the
  source of truth (wherever `vendor/shared` is generated/copied from — confirm
  location before editing) and regenerate the vendored copy, not hand-edit the
  vendored file directly.
- `pnpm db:generate` (drizzle-kit) to produce the migration — never hand-write
  migration SQL per repo convention.
- Test: extend whatever test seeds/exercises `skills.source` (check
  `server/src/db/seed.ts` and any skills-adjacent test) to cover the new value.

## 2. Server — skills CRUD module (`server/src/modules/skills/`)

New module, mirrors the `agents` module's shape (repository → service → routes,
per the onion-architecture rules already applied elsewhere in this repo):

- `repository.ts`: `list(workspaceId)`, `get(workspaceId, id)`, `insert(...)`,
  `update(id, patch)` (bumps `version`, writes a `skill_versions` row — mirrors
  `agent_versions` snapshot pattern already in `agents/repository.ts`),
  `setEnabled(id, enabled)`, `delete(id)` (cascades `agent_skills` rows via FK
  `onDelete: 'cascade'`, already declared in schema), `versions(skillId)`.
- `service.ts`: thin orchestration wrapping the repository, `Container`-typed
  per the onion pattern (no direct DB access from routes).
- `routes.ts`:
  - `GET /skills` → list (workspace-scoped)
  - `GET /skills/:id` → one + latest version
  - `POST /skills` → create (source='manual' unless import endpoint, §4)
  - `PUT /skills/:id` → update body/name/description/type (snapshots a version)
  - `PATCH /skills/:id/enabled` → toggle (no version bump — matches "Enabled"
    toggle behavior implied by the mock's `SkillCard`/`SkillConfigTab`, where
    toggling is separate from "Save skill")
  - `DELETE /skills/:id` → delete (mock's "Removes it from all agents" confirms
    cascade-unlink is expected, not a soft block)
  - `GET /skills/:id/versions` → version history list (scope confirmed: list only,
    no diff/restore UI this pass)
- Register in `server/src/modules/index.ts` alongside the other modules.
- Tests: unit test for any pure helper (version-bump logic), integration test
  (`.it.test.ts`, Docker-gated like the others) for the CRUD routes — follow the
  `pulls-comments.it.test.ts` pattern (MockGitHubClient-style fixtures aren't
  needed here since skills have no external dependency, just DB).

## 3. Server — wire skills into the review run (req #2/#3 actual gap)

In `run-executor.ts`, near where `agent.systemPrompt` is read (line ~191):

- Fetch the agent's enabled linked skills, ordered: reuse
  `agents/repository.ts`'s `linkedSkills(agentId)` (already returns skill rows in
  `order` ascending) — filter to `skill.enabled === true` (a linked-but-disabled
  skill should NOT be injected; confirm this reading of "toggle enabled" against
  the mock's `SkillCard` toggle, which visually dims but doesn't unlink).
- Map to `PromptParts.skills: string[]` = each enabled linked skill's `body`, in
  order — pass into the existing `reviewPullRequest({ ..., skills, ... })` call.
  This is a ONE-LINE addition to an existing call, since `PromptParts.skills`
  already exists in reviewer-core.
- **Token count per skill (req #3)**: `container.tokenizer` (TiktokenTokenizer,
  already used for the repo-map budget search) can count each skill body's
  tokens. `PromptAssembly` (shared type, `reviewer-core/src/prompt.ts` /
  wherever `PromptAssembly` itself is defined — check `vendor/shared`) currently
  stores `skills` as ONE joined string, no per-skill breakdown. Add a sibling
  field for the trace only (not the prompt itself): `skills_meta: { skill_id,
  name, tokens }[]` — populated in run-executor (not reviewer-core, to keep
  reviewer-core's DB-free purity — it never needs `skill_id`/`name`, only the
  body text) and stored alongside the review row (check how `prompt_assembly` is
  currently persisted — likely a jsonb column on `reviews`/`agent_runs` — add
  `skills_meta` there, needs its own tiny migration).
- Confirmed by your answer: no live A/B "findings changed by this skill"
  computation — the run trace just shows tokens added per skill, full stop.

## 4. Server — import endpoint (req #4)

Scope: your requirement is skill-only import ("імпортувати зовнішні скіли...
з файлу/архіву"), narrower than the existing `PluginBundle` contract (which
bundles agents+skills+eval_cases+conventions together, and has no implemented
routes yet — `grep` confirmed nothing serves `/plugins/*` today). Two paths:

- **(a) Dedicated, narrower endpoint (recommended, matches the requirement
  literally)**: `POST /skills/import` accepting a single skill file — either a
  raw `.md` (body = file content, name from filename or an optional YAML
  frontmatter `name:`/`type:`/`description:` block) or a small archive containing
  exactly one `.md` (per your explicit constraint: "лише один markdown-файл на
  скіл" — no file tree). Two-step, matching req #4's "обов'язкове прев'ю":
  1. `POST /skills/import/preview` — parses the upload, returns a `Skill`-shaped
     preview (name/description/type/body) WITHOUT writing to the DB. Body is
     rendered as inert text (per your answer) — no markdown→HTML execution path,
     no code-fence evaluation, nothing in the body is ever treated as
     instructions to the importing agent/tool-loop.
  2. `POST /skills/import` (with the previewed payload, possibly edited by the
     user first) — writes it, `source='imported_file'`.
  - Reject non-markdown/non-archive uploads and archives containing more than one
    file at the root (or a nested tree) — matches the "one markdown file per
    skill" constraint as a hard validation rule, not just a UI convention.
- **(b) Build on `PluginBundle`/`/plugins/import`**: heavier — would require
  implementing the whole plugin-import route (agents+skills+eval_cases+
  conventions) that doesn't exist yet, for a requirement that only asked for
  skills. Not recommended for this pass; leave `PluginBundle` for whenever the
  full plugin-export/import feature is actually requested.
- "Community" search (mock's `SkillSearchPanel`, `COMMUNITY_SKILLS`) — explicitly
  out of scope per your requirements; the `community` SkillSource value and
  `CommunitySkill` contract stay in the schema/contracts unused (dead but
  harmless) rather than removed, since removing them is a bigger, unrelated
  change and they don't block anything.

## 5. Client — Skills Lab screen (`client/src/app/skills/`)

New route, per ui-architecture conventions (kebab-case dirs, colocated
`_components/`, barrel `index.ts`):

- `app/skills/page.tsx` — list + editor split view (mirrors `screen_skills.jsx`'s
  layout: 290px left list, flexible center editor).
- `_components/SkillCard/` — list item (name, description, type badge, source
  icon, enabled toggle) — per your scope decision, drop the mock's "N agents /
  pull% / accept%" footer (that's the Stats tab, out of scope this pass).
  Colocated since used only on this one route.
- `_components/SkillEditor/` with tabs **Config, Preview, Versions** only (per
  your answer — Evals/Stats/Context dropped):
  - `_components/ConfigTab/` — name/description/type fields, body `CodeEditor`
    (mock has a line-numbered mono editor with a live token count — reuse
    whatever text-editor primitive the codebase already has, or a plain
    `<textarea>` if none exists; check `@devdigest/ui` first), Save/Cancel,
    enabled toggle, Delete-with-confirm.
  - `_components/PreviewTab/` — rendered markdown (mock's `MarkdownPreview` is a
    hand-rolled lightweight renderer — check if the client already has a
    markdown-rendering dependency before reimplementing one; if not, a minimal
    heading/list/code-fence renderer like the mock's is enough, no need for a
    full markdown library given the constrained input shape).
  - `_components/VersionsTab/` — read-only list from `GET /skills/:id/versions`,
    no diff/restore actions (mock has Diff/Restore buttons — explicitly excluded
    per your scope answer).
- "Add Skill" entry point: dropdown with **Create from scratch**, **Import from
  file** (per §4a) — drop "Import from URL" (not in your requirements — your req
  #4 says file/archive specifically) and "Search community skills…" (out of
  scope). Confirm dropping "Import from URL" is intended, or keep it as a thin
  wrapper that fetches the URL server-side then reuses the same preview flow —
  small either way, flagging as an open question rather than deciding here.
- Data fetching: TanStack Query hooks in `client/src/lib/hooks/` (matching
  existing `useFindingAction` etc.) — `useSkills()`, `useSkill(id)`,
  `useCreateSkill()`, `useUpdateSkill()`, `useToggleSkill()`, `useDeleteSkill()`,
  `useImportSkillPreview()`, `useImportSkill()`.

## 6. Client — Agent Editor Skills tab (req #2, client side)

- `app/agents/[id]/_components/AgentEditor/_components/SkillsTab/` (new,
  colocated under AgentEditor per existing `ConfigTab` sibling pattern).
- Ordered, draggable list of ALL skills, each with a checkbox (linked/not) —
  matches mock's `SkillsTab` exactly: drag handle, checkbox, name, type badge.
  Drag-reorder writes through `PUT /agents/:id/skills` (`setSkills`, already
  implemented server-side) on drop; checkbox toggle does the same (add/remove
  from the ordered list, preserving relative order of the rest).
- Register `"Skills"` in `AgentEditor.tsx`'s `TABS` (currently Config-only per
  the file's own comment).

## 7. Client — trace drawer Skills block (req #3, client side)

- Reuse the existing prompt-assembly trace viewer (wherever
  `T.prompt.skills`/`PROMPT_BLOCKS` from the mock maps to real code — locate the
  actual PR-detail run-trace component; the mock's `screen_trace.jsx` is the
  reference, not the literal file to port) to render the "Skills — enabled skill
  bodies" block using the real `prompt_assembly.skills` string now populated by
  §3, plus a "Skills loaded" badge row (skill names for that run).
- Add the per-skill token count (§3's `skills_meta`) as small `+N tok` labels
  next to each skill badge — the concrete answer to "скільки токенів додав."

## 8. Suggested build order (small steps, test after each)

1. §1 schema/contract enum addition + migration — smallest, unlocks everything else.
2. §2 skills CRUD module, server only — testable in isolation via `.it.test.ts`.
3. §3 run-executor wiring — testable via existing review-run integration tests
   (`reviews.it.test.ts`) extended with a case that asserts a linked skill's body
   appears in `prompt_assembly.skills`.
4. §4 import endpoint — testable in isolation (upload → preview → confirm → GET).
5. §5 Skills Lab client screen (list/create/edit/preview/versions) — can be
   built once §2 exists, independent of §3/§4/§6/§7.
6. §6 Agent Editor Skills tab — depends only on already-existing server routes
   (`GET/POST /agents/:id/skills`) + §5's skill-fetching hook — could actually go
   BEFORE §5 if you want the agent-linking UI sooner (server side is 100% ready).
7. §7 trace viewer Skills block — depends on §3.

## 9. Open questions carried into build (not blocking the plan, flagged for when reached)

- Exact location/format of `PromptAssembly`'s persisted storage (which table/
  column) — needs a read of the actual persistence code before §3's migration is
  written (not yet located in this session).
- Whether "Import from URL" (in the mock but not your literal requirement) should
  be kept, dropped, or deferred (§5).
- Where the vendored `vendor/shared/contracts` source of truth actually lives
  (needs confirming before editing `SkillSource`, since the vendored copy itself
  is read-only per CLAUDE.md).
