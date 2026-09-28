# Skills feature — technical spec

Status: SPEC ONLY. No code written. Based on: your 6 product requirements, the
design mock (`tmp/Dev Digest/screen_skills.jsx`, `screen_agents.jsx`,
`screen_trace.jsx`), and the current codebase (much of the data model and
agent-linking already exists — noted inline as **[EXISTS]** vs **[NEW]**).

**Changelog**
- 2026-09-28: checked `tmp/DevDigest Design (standalone) (3).html` (the file
  pointed to when asked to re-verify a "new" design attachment) against this
  spec. That export is a design-canvas bundle whose Skills-related content is
  only the nav breadcrumb label "Skills Lab" — none of the actual Skills Lab /
  skill editor / Agent Skills tab / trace-drawer markup or strings (`Version
  history`, `Rendered as the reviewing agent receives it`, `Add Skill`,
  `Import from file`, `Order matters — earlier skills appear earlier in the
  assembled prompt`, etc.) are present in it. The detailed source files this
  spec is actually built from (`tmp/Dev Digest/screen_skills.jsx`,
  `screen_agents.jsx`, `screen_trace.jsx`) are unchanged since they were first
  read (same file timestamps, same content). **No design changes found — this
  spec's data model, endpoints, UI components, and prompt-assembly/import logic
  (sections 1–7 below) are confirmed still accurate, nothing updated.**

---

## 1. Data model

### `skills` table **[EXISTS — server/src/db/schema/skills.ts]**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `workspace_id` | uuid FK → workspaces, cascade delete | workspace-scoped |
| `name` | text | |
| `description` | text | short summary — the card subtitle |
| `type` | enum: `rubric` \| `convention` \| `security` \| `custom` | |
| `source` | enum: `manual` \| `imported_url` \| `extracted` \| `community` \| **`imported_file`** (**[NEW]** — add for req #4, file/archive import) | provenance tag, not a permission |
| `body` | text | the ONLY thing sent to the model — everything else is metadata |
| `enabled` | boolean, default true | gates injection into the prompt (§4) |
| `version` | integer, default 1 | bumped on every body/metadata save |
| `evidence_files` | jsonb string[], nullable | optional — paths the skill was extracted from, if `source='extracted'` |
| `created_at` | timestamp | |

### `skill_versions` table **[EXISTS]**

| Column | Type | Notes |
|---|---|---|
| `skill_id` | uuid FK → skills, cascade | |
| `version` | integer | composite PK with `skill_id` |
| `body` | text | snapshot at save time |
| `created_at` | timestamp | |

Immutable history — every save writes a new row here, current state stays in
`skills.body`. Mirrors the existing `agent_versions` pattern.

### `agent_skills` link table **[EXISTS — server/src/db/schema/agents.ts]**

| Column | Type | Notes |
|---|---|---|
| `agent_id` | uuid FK → agents, cascade | |
| `skill_id` | uuid FK → skills, cascade | composite PK with `agent_id` |
| `order` | integer, default 0 | **this is the field that drives prompt-block sequence (§4)** |

Many-to-many, as required (req #6 — same skill reusable across agents). No
`enabled` column here — a link is either present or not; the skill's OWN
`enabled` flag (not the link) gates injection (§4), matching the mock's
`SkillCard` toggle behavior (dims the card, doesn't remove it from agents).

### Trace/run persistence addition **[NEW]**

Wherever the run's `prompt_assembly` is persisted (needs locating in the actual
review-run persistence code before implementing — flagged as an open item, not
resolved here), add a sibling field:

```
skills_meta: { skill_id: string; name: string; tokens: number }[]
```

Populated per-run in `run-executor.ts` (not in `reviewer-core`, to keep that
package DB/metadata-free) — the token count answers req #3's "скільки токенів
додав," the array order matches the prompt-block order.

---

## 2. Server endpoints

### Skills CRUD **[NEW — server/src/modules/skills/]**

| Method | Path | Behavior |
|---|---|---|
| GET | `/skills` | list, workspace-scoped |
| GET | `/skills/:id` | one skill + current body |
| POST | `/skills` | create (`source='manual'` for req #5's "create from scratch") |
| PUT | `/skills/:id` | update name/description/type/body — bumps `version`, snapshots old body into `skill_versions` |
| PATCH | `/skills/:id/enabled` | toggle only — no version bump (separate from "Save skill" per the mock) |
| DELETE | `/skills/:id` | hard delete; `agent_skills` rows cascade (FK already declared) — matches mock's "Removes it from all agents. This can't be undone." |
| GET | `/skills/:id/versions` | version history list (read-only — no diff/restore endpoint this pass) |

### Agent↔skill linking **[EXISTS — server/src/modules/agents/routes.ts]**

| Method | Path | Behavior |
|---|---|---|
| GET | `/agents/:id/skills` | linked skills, ordered |
| POST | `/agents/:id/skills` | body is EITHER `{ skill_ids: string[] }` (full replace + reorder — order = array index) OR `{ skill_id, order? }` (link one) |

Nothing to build here — `repository.ts`'s `linkedSkills`/`linkSkill`/`unlinkSkill`/
`setSkills` and `service.ts`'s wrappers already implement this exactly.

### Import **[NEW]**

Two-step, per req #4's mandatory-preview rule:

| Method | Path | Behavior |
|---|---|---|
| POST | `/skills/import/preview` | accepts a file upload (`.md`, or an archive containing exactly one `.md` at its root — no nested tree, matching the "one markdown file per skill" constraint). Parses name (frontmatter `name:` or filename), description, type, body. **Does not write to the DB.** Returns the parsed `Skill`-shape for the UI to render + let the user edit before confirming. |
| POST | `/skills/import` | takes the (possibly user-edited) previewed payload, writes it with `source='imported_file'` |

Validation (hard rejects, not just UI hints):
- reject non-markdown/non-single-file archives
- reject a body over some size ceiling (prevents pathological huge-file abuse of
  the workspace's skill list)
- no execution of anything in the file at any stage (§5)

---

## 3. UI components

### Skills Lab page **[NEW — client/src/app/skills/]**

```
app/skills/
  page.tsx                          — split view: list (left) + editor (center)
  _components/
    SkillCard/
      SkillCard.tsx                 — name, description, type badge, source icon, enabled toggle
      constants.ts                  — SKILL_TYPE / SKILL_SOURCE color+icon maps
    SkillEditor/
      SkillEditor.tsx               — tab shell (Config | Preview | Versions)
      _components/
        ConfigTab/
          ConfigTab.tsx             — name/description/type fields, body editor, Save/Cancel, enabled toggle, Delete-with-confirm
        PreviewTab/
          PreviewTab.tsx            — rendered markdown, "as the reviewing agent receives it"
        VersionsTab/
          VersionsTab.tsx           — read-only version list (no diff/restore)
    ImportDialog/
      ImportDialog.tsx              — file picker → calls /skills/import/preview → shows editable preview → confirm calls /skills/import
```

Scope note: mock's Evals/Stats/Context tabs and community-search drawer are
explicitly out of your requirements — not built.

### Agent Editor — Skills tab **[NEW — extends existing AgentEditor]**

```
app/agents/[id]/_components/AgentEditor/_components/SkillsTab/
  SkillsTab.tsx    — ordered list of ALL workspace skills, each row:
                     drag handle · checkbox (linked?) · name · type badge
                     drag reorder + checkbox toggle both write through
                     POST /agents/:id/skills (already implemented server-side)
```

Registered as a new entry in `AgentEditor.tsx`'s `TABS` (file currently says
"Part-0 starter ships Config only" — this is the first tab added to that list).

### Trace drawer — prompt assembly section **[extends existing trace UI]**

Locate the real run-trace component (mock's `screen_trace.jsx` `TraceDrawer` is
the reference, not a literal file to port). Add/complete:
- a "Skills — enabled skill bodies" block in the existing prompt-block list,
  rendering the now-populated `prompt_assembly.skills` string, expandable to
  full text (same pattern as the System/Repo-skeleton/Diff blocks already there)
- a "Skills loaded" badge row (skill names used in that run)
- per-skill `+N tok` label next to each badge, sourced from `skills_meta` (§1)

---

## 4. Prompt assembly logic

**[EXISTS — reviewer-core/src/prompt.ts, `assemblePrompt()`]** — already built,
just needs real data fed in (§ below). How it works today:

1. `PromptParts.skills?: string[]` — an ordered array of skill body strings.
2. `assemblePrompt()` joins them: `parts.skills.join('\n\n')` → one block.
3. That block is inserted into the user message under a `## Skills / rules`
   heading, positioned: task line → PR description → **skills block** → memory
   → repo skeleton → project context → callers → diff. Order among these
   SECTIONS is fixed by `assemblePrompt`'s own section order — not configurable.
4. **Order WITHIN the skills block** is what `agent_skills.order` controls: the
   array passed to `PromptParts.skills` must be built by sorting the agent's
   linked, enabled skills by `order` ascending before mapping to `.body` — that
   sort is the ONLY place skill order has any effect. Two skills with different
   order still land in the same `## Skills / rules` section, just concatenated
   in that sequence (first skill's body first, `\n\n`-joined).
5. The whole user message (including the skills block) sits in an untrusted
   section boundary already — no, correction: the skills block itself is NOT
   `wrapUntrusted`-wrapped (unlike diff/specs/repo-map/callers) — skill bodies
   are treated as trusted, operator-authored content, consistent with your
   framing that a skill is "лише текстова конфігурація" the workspace owner
   wrote or vetted (imported skills still get preview-approved by a human before
   being saved — the trust boundary is at import time, §5, not at prompt-assembly
   time).

**What's missing (the actual gap)**: `run-executor.ts` currently calls
`reviewPullRequest({ systemPrompt: agent.systemPrompt, ... })` without a
`skills` key. Fix is: fetch `agents/repository.ts`'s `linkedSkills(agentId)`
(already sorted by `order`), filter to `skill.enabled === true`, map to
`.body`, pass as `skills: [...]`. That's the entire wiring change — everything
downstream already exists.

---

## 5. Secure import logic

Threat model (per your confirmed answer): a skill body is inert markdown text,
never executed, never interpreted as an instruction to any tool-loop. The only
things to guard against:

1. **Parsing, not executing.** The import parser reads the upload as plain
   bytes/text — frontmatter (if present) is parsed as data (name/type/
   description fields only, whitelisted keys — any other frontmatter key is
   dropped, not stored, not acted on). No `eval`, no template interpolation, no
   shell-out on any part of the file, ever, at any stage (preview or confirm).
2. **Archive handling.** If a `.zip`/similar is uploaded: extract to a
   TEMP/EPHEMERAL location, verify it contains exactly ONE file, that file is
   `.md`, and there is no nested directory structure — reject otherwise (matches
   your explicit "лише один markdown-файл на скіл" constraint as a hard
   validation, not a soft UI hint). Never write extracted archive contents
   anywhere persistent except the single validated `.md`'s text into the `body`
   column. Use a well-vetted archive library with zip-bomb / path-traversal
   protections (`../` entries, symlink entries rejected) — standard archive-
   handling hygiene, not specific to this feature.
3. **Rendering the preview safely.** The Preview tab (§3) renders the body as
   markdown — use the SAME lightweight, non-`dangerouslySetInnerHTML` renderer
   the mock uses (`MarkdownPreview`: hand-parses headings/lists/code-fences into
   React elements, no raw HTML pass-through) so an imported body containing
   `<script>` or event-handler-bearing HTML never executes in the reviewer's
   browser. This is the actual injection surface for "import" (XSS in the
   preview UI), more than anything server-side — worth explicit test coverage.
   Confirm the client doesn't already have a markdown lib that renders raw HTML
   by default (e.g. `react-markdown` with `rehype-raw` would defeat this — if
   adopting a library instead of the hand-rolled renderer, disable raw-HTML
   passthrough explicitly).
4. **Mandatory preview gate.** `/skills/import/preview` never writes to the DB —
   architecturally enforced by simply not calling any insert in that handler,
   not by a client-side "did you see the preview" flag. The only path that
   writes is `/skills/import`, and the client only calls it after rendering the
   preview response to the user (UI flow, not a server-enforceable guarantee
   beyond "preview must have been the prior call" — acceptable, since the
   marked-untrusted rendering in step 3 is the real safety boundary, not a
   workflow gate).
5. **Size ceiling.** Reject bodies beyond some cap (e.g. 100–200KB of text) at
   parse time — a skill is meant to be a markdown rules doc, not an arbitrary
   payload; this also bounds prompt-token cost per skill (relevant to req #3's
   token accounting).

---

## 6. Implementation order

1. **Schema**: add `imported_file` to `SkillSource` enum (schema.ts + shared
   contract) + `pnpm db:generate` migration. Smallest change, unlocks everything.
2. **Skills CRUD module** (server, §2 first table) — fully testable in isolation
   via integration tests, no dependency on anything else in this plan.
3. **Prompt-assembly wiring** (§4's "what's missing" — the `run-executor.ts`
   one-line addition + `skills_meta` token-count field + its persistence
   migration) — testable via the existing review-run integration test suite,
   extended with a case asserting a linked skill's body lands in
   `prompt_assembly.skills`.
4. **Import endpoint** (§2 second table + §5) — testable in isolation
   (upload → preview → confirm → GET), no UI dependency yet.
5. **Skills Lab client page** (§3 first block) — depends only on step 2's
   routes existing.
6. **Agent Editor Skills tab** (§3 second block) — depends ONLY on
   already-existing server routes (`GET/POST /agents/:id/skills`) — could be
   built in parallel with or even before step 5, since its server side needs no
   new work.
7. **Trace drawer Skills block** (§3 third block) — depends on step 3.

Steps 2 and 6 have no dependency on each other and could be parallelized if
more than one person/session is working this; steps 1→3 and 2→4/5 are the only
hard orderings.

---

## 7. Worked example — seed agent + skills

Concrete example to ground the data model and validate the prompt-assembly
logic against, per your answer. Not required for the feature to work generically
— this is one seed agent, useful as the first manual test case for steps 2/3/6.

### Agent: **Test Quality Reviewer**

| Field | Value |
|---|---|
| `name` | `Test Quality Reviewer` |
| `description` | Reviews test changes for coverage gaps, missed edge cases, over-mocking, and flaky patterns — not a general code reviewer. |
| `provider` / `model` | any configured provider (no constraint from this spec) |
| `system_prompt` | e.g. "You review TEST CODE changes only. Judge coverage, edge-case handling, mock usage, and determinism — not style or unrelated business logic." (illustrative — final wording is an implementation detail, not part of this spec) |
| `strategy` | `single-pass` (default) |
| `repo_intel` | on (helps it see what production code a test file is exercising) |

### Linked skills (4 — one per responsibility named in your brief), in this `order`

| order | name | type | what it checks | why this type |
|---|---|---|---|---|
| 0 | `coverage-gap-rubric` | `rubric` | Flags changed production code paths (new branches, new error handling, new conditionals) that the accompanying test diff does NOT exercise. A scored rubric ("does this PR's tests cover its own branches?"), not a fixed convention — matches `rubric` (mock's own type description: "rubric" = scored check). | `rubric` |
| 1 | `corner-case-checklist` | `convention` | House checklist for commonly-missed edge cases: empty/null input, boundary values (0, -1, max), concurrent/duplicate calls, error-path assertions — a fixed list of things to look for, not a scored judgment. | `convention` |
| 2 | `no-over-mocking` | `convention` | Flags tests that mock so much of the system under test that the test no longer verifies real behavior (e.g. mocking the function being tested, mocking every collaborator instead of using a real in-memory fake) — a house convention against a known anti-pattern, same spirit as this repo's own `react-testing-library` skill's "common anti-patterns" section. | `convention` |
| 3 | `flaky-test-patterns` | `custom` | Detects non-deterministic test patterns: unseeded randomness, real timers/`setTimeout` without fake-timer control, real network/filesystem calls, order-dependent shared state between tests, unpinned `Date.now()`. Doesn't fit `rubric` (not scored) or `convention` (broader "code smell" detection, not one house rule) — falls to `custom`, matching the type's own catch-all purpose. | `custom` |

`order` here directly determines their sequence inside the assembled prompt's
`## Skills / rules` block (§4) — coverage gaps first (most likely to gate a
PR), corner cases second, mocking hygiene third, flakiness last (often the
subtlest / lowest-frequency finding). This ordering is a judgment call, not a
hard requirement — an implementer can re-order at build time without touching
this spec's structural claims.

Each skill's `body` is skill-authored markdown (out of scope for this spec —
written when step 2/6 is actually implemented, not specified here), `source:
'manual'`, `enabled: true`, linked to this one agent (though per req #6, any of
these 4 could be reused on other agents later — e.g. `no-over-mocking` is
generically useful wherever an agent reviews test files, not exclusive to this
agent).
