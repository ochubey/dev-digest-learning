# Plan: Project Context (SPEC-02)

Spec: `specs/02-project-context.md` (SPEC-02, rev 2, status `approved`). Branch: `feat/pr-brief` (same PR as PR Brief).
Execution mode: **single-agent, decided by the user** (section 9). Order: P1 → P2 → P3a → P3b → P4 → P5 → P7 → P6 → P8, with a report to the user after each wave.
Decisions: A-1 = separate always-expanded Context tab in the Skill editor (OQ-12 default); A-2 = approved (`PROJECT_DOCS_SOURCE=fixture` in `scripts/e2e.sh` and `e2e-web.yml`).
Author: `implementation-planner` (read-only); saved by the caller.

## Rev 3 change (D-16: folder scope widened)

Discovery lists every eligible `.md` file of main (cap 500) instead of `specs/`, `docs/`, `insights/` only. Touched tasks:

- P1 contracts: `ContextSource` = specs | docs | insights | root | other (`PROJECT_CONTEXT_SOURCES`), `PROJECT_CONTEXT_MAX_DISCOVERED = 500`, `ContextDiscovery.total` + `truncated` (both copies identical).
- P3a pure layer and adapters: `isContextDocPath` (shared by discovery, preview, attach validation, resolver re-validation), `classifySource`, `isIgnoredFolder`; Octokit truncated-tree fallback walks all non-ignored trees (max 200 requests); fixture gains `README.md` and `client/specs/ui-components.md`.
- P3b service: discover sorts by group order then path, caps at 500, reports `total` / `truncated`.
- P6 client: `SOURCE_ORDER`, `SERIALIZE_HEADINGS`, `SOURCE_COLOR`, `sourceOfPath`, truncated notice, new empty-state text.
- P8 seed, e2e, docs: flow 09 (6 documents, "2 of 6 attached"), e2e and server READMEs. `run-executor.ts` untouched.

## 0. Spec gate

- Status is `approved`. OQ-1..OQ-3 are resolved as D-13..D-15.
- No `[NEEDS CLARIFICATION]` tag blocks this plan. Remaining tags (OQ-4..OQ-14, NFR targets) have defaults and the ACs are written against them:
  - OQ-4: top-level `specs/ docs/ insights/`, recursive, `.md` only.
  - OQ-5: "Serializes as" is a preview only.
  - OQ-6: count agents through enabled skills, disabled agents included.
  - OQ-7: the brief is unchanged.
  - OQ-8: use `repos.default_branch`.
  - OQ-9: the section repeats in every map-reduce chunk call. Already true: `reviewer-core/src/review/run.ts:208` re-runs `assemblePrompt` with the same `promptParts` per chunk.
  - OQ-10: CI runner out of scope.
  - OQ-11: version restore does not restore attachments.
  - OQ-13: deterministic fixture source plus a seeded trace (A-2).
  - OQ-14: empty documents skipped with reason `empty`.
- All 68 ACs are mapped (section 5).
- Two decisions need user sign-off before P6 and P8 (A-1, A-2 in section 6).

## 1. Research findings

### 1a. Listing files at the main branch tip
- No adapter can list a directory today:
  - `GitHubClient` (`server/src/vendor/shared/adapters.ts:152-187`) only has `readRepoFile(repo, path, sha)`.
  - `GitClient.readFile` (`adapters.ts:246`, `server/src/adapters/git/simple-git.ts:160`) reads the clone's working tree, at `origin/<default_branch>` only after `sync()` (`repo-intel/service.ts:151`).
- `OctokitGitHubClient.readRepoFile` (`server/src/adapters/github/octokit.ts:437-464`) returns `null` on 404/410 and non-files, throws otherwise (gives `not_found` vs `read_error`). It decodes with `Buffer.toString('utf-8')`, which silently replaces invalid bytes, so it **cannot detect `not_text` (AC-49)**; a byte-level read is needed.
- **Decision:** add a server-local port `ProjectDocsSource`:
  - `resolveBranchHead(repo, branch) -> sha` (via `repos.getBranch`).
  - `listTree(repo, sha) -> {path, kind: 'blob'|'tree'|'symlink'|'submodule', blobSha}[]` (via `git.getTree({recursive:'true'})`; mode `120000` = symlink, excluded per AC-15; on `truncated`, fall back to one non-recursive walk per folder).
  - `readBlob(repo, path, sha) -> Uint8Array | null` (via `repos.getContent` on the sha, base64 decoded to bytes, wrapped in `withRetry`/`withTimeout`).
- The port lives in `server/src/modules/project-context/ports.ts`, not in `vendor/shared/adapters.ts`, so vendored changes stay limited to contract files (constraint and AC-62).
- Rate limits: one `getBranch`, one `getTree`, N `getContent` per discovery. Token counts are cached by blob sha, so re-discovery reads only changed blobs.

### 1b. Prompt engine (`reviewer-core/src/prompt.ts`)
- `PromptParts.specs?: string[]` (line 98) renders blocks labelled `spec-<i>` (line 204), after `## Repo skeleton` and before callers (line 259).
- `wrapUntrusted` (lines 48-52) escapes only `</untrusted>`: it does not handle a fake opening tag or a `"` in the label (fails AC-45).
- `INJECTION_GUARD` (lines 18-32) does not name project documents (fails AC-43).
- `assembly.specs` is one joined string (line 306).
- **Decision:** add a separate `projectContext?: {path, content}[]` input and a new `wrapProjectDoc`. Keep `wrapUntrusted` and the base guard byte-identical. Append a `PROJECT_CONTEXT_GUARD` sentence only when the section is present (guarantees AC-47).
- `reviewPullRequest` already forwards `specs` (`review/run.ts:162`); the new field follows the same path.

### 1c. Run executor (`server/src/modules/reviews/run-executor.ts`)
- Skills are enabled-filtered from `this.agents.linkedSkills(agent.id)` (lines 425-431), tokenised with `container.tokenizer.count`.
- `specs_read: []` is hard-coded in `finishRun` (line 640) and `traceFromBuffer` (line 783, used for failures and cancels, line 507).
- `specs` is never passed to `reviewPullRequest` (lines 438-473).
- PR repo (`repo.owner/name`) and `pull.repoId` are in scope.

### 1d. DB and versioning
- `agents` (`server/src/db/schema/agents.ts:8-36`) and `skills` (`schema/skills.ts:5-21`) have no attachment storage. `agent_skills` has no `enabled` column: "enabled linked skill" means `skills.enabled` (as run-executor line 426).
- Agent version: `AgentsRepository.update` bumps and snapshots `config_json` only when `isConfigChange` (`agents/helpers.ts:64-89`). `setSkills` (`agents/repository.ts:229`) does not bump.
- Skill version: `SkillsRepository.update` always snapshots the old body and bumps (`skills/repository.ts:81-100`). `skill_versions` stores the body only.
- `AgentVersionConfig` (`server/src/vendor/shared/contracts/knowledge.ts:273`) is a non-strict zod object, so an extra `context_paths` key is stripped on parse; no contract change needed.

### 1e. Access pattern for AC-63
- `getContext` (`modules/_shared/context.ts`) always yields the default workspace (`LocalNoAuthProvider`).
- 403 pattern elsewhere: load the row without a workspace filter; missing -> 404; `row.workspaceId !== workspaceId` -> `AppError('forbidden','Forbidden',403)` (see `blast/routes.ts:38`, `brief/service.ts:146`). A "non-member" in tests means a resource seeded in another workspace.

### 1f. Client
- `AgentEditor` (`client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`) has only `config` and `skills` tabs (`constants.ts:12-13`, `?tab=`).
- `SkillsTab` already uses dnd-kit with `KeyboardSensor` and save-on-toggle; reuse the pattern.
- `SkillEditor` (`client/src/app/skills/_components/SkillEditor/SkillEditor.tsx`) has only Config / Preview / Versions. `skill: Skill | null` is create mode (AC-34).
- `Drawer` (`client/src/vendor/ui/kit/Drawer.tsx`) has `role="dialog"` but no accessible label, Escape handling or focus return. `vendor/ui` is read-only, so AC-67 needs a feature-local dialog.
- `Markdown` (`client/src/vendor/ui/primitives/Markdown.tsx`) is react-markdown 9 + remark-gfm without rehype-raw: no raw HTML (AC-36).
- `@tanstack/react-query ^5.62` supports `useMutation({ scope: { id } })` for serial mutations (AC-24).
- `TraceBody.tsx` (`client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:51-63, 97-99`) renders `specs_read` as strings and `specs` as one `PromptBlock`. The drawer opens via `?trace=<runId>` (`page.tsx:62,182-189`).
- The client fetches the trace untyped (`client/src/lib/hooks/trace.ts:15`), so the UI must handle legacy shapes itself (AC-59).
- Dead stubs: `useContextFiles` / `useReindexContext` (`client/src/lib/hooks/core.ts:159-174`) call endpoints the server lacks; `client/messages/en/context.json` is an unused namespace containing `"chunks"` (would break AC-25's grep).

### 1g. e2e and seed
- The e2e stack runs the **real** container: no GitHub token, no mock adapter (`.github/workflows/e2e-web.yml:65-94`, `scripts/e2e.sh`). `MockGitHubClient` (`server/src/adapters/mocks.ts:140-271`) is reachable only via `ContainerOverrides` in vitest.
- The seed (`server/src/db/seed.ts`) inserts reviews and findings but **no `agent_runs` or `run_traces`**.
- So AC-65 needs a deterministic docs source selectable on the real server, and AC-66 needs a new seeded run and trace (A-2).

## 2. Spec claims that do not match code

1. **AC-62 "identical vendored copies".** Not identical today: `trace.ts` is 133 lines (server) vs 132 (client) with differing `PromptAssembly` comments; `knowledge.ts` 291 vs 260; `adapters.ts` 308 vs 245. `server/test/contracts-parity.test.ts` checks only `brief.ts`. P1 makes `trace.ts` and `platform.ts` byte-identical and adds them to the parity test; `knowledge.ts` and `adapters.ts` stay out of scope.
2. **Design tabs.** A Skill editor tab set "Config, Context, Preview, Evals, Stats, Versions" does not exist; real tabs are Config/Preview/Versions, and the Agent editor has Config/Skills. See A-1.
3. **"Enabled linked skills".** No per-link enabled flag; it means `skills.enabled`.
4. **AC-22 version bump.** Agent version moves only through `update()`; skill links do not bump. A new explicit compare-and-bump is needed, and it must not bump on an identical list (skills currently bump on every `update`).
5. **`readRepoFile` cannot detect non-UTF-8** (lossy decode); AC-49 `not_text` needs a byte-level read.
6. **OQ-13 default** (mock GitHub adapter) cannot reach the e2e server (1g); a fixture source selected by env is needed.
7. **AC-66 "seeded `run_traces` row"** does not exist; P8 adds it.
8. **Dead client code** (`useContextFiles`, `useReindexContext`, `context.json` with "chunks") is removed or replaced in P6 so AC-25's grep passes.
9. **`SpecFile`** (`contracts/platform.ts:281`) is only referenced by the dead stub; keep it, mark deprecated, add new schemas beside it (additive, AC-62).

## 3. Implementation strategy

### Contracts (P1, both copies byte-identical)

`contracts/platform.ts` (additive):
- `PROJECT_CONTEXT_FOLDERS = ['specs','docs','insights'] as const`, `PROJECT_CONTEXT_SOFT_CAP_TOKENS = 4000`, `PROJECT_CONTEXT_HARD_CEILING_TOKENS = 32000`
- `ContextSource = z.enum(['specs','docs','insights'])`
- `ContextDoc = {path, name, folder, source, tokens: int}`
- `ContextDiscovery = {repo_id, branch, commit_sha, docs: ContextDoc[]}`
- `ContextDocPreview = {path, source, tokens, used_by: int, content, commit_sha}`
- `ContextAttachments = {paths: string[], version: int}`
- `InheritedContextDoc = {path, skill_id, skill_name}`
- `AgentContextAttachments = ContextAttachments.extend({inherited: InheritedContextDoc[]})`
- `ContextAttachmentsInput = {paths: string[]}`, `DefaultContextRepo = {repo_id: string | null}`

`contracts/trace.ts` (additive):
- `SpecSkipReason = z.enum(['not_found','read_error','not_text','invalid_path','over_budget','empty'])`
- `SpecReadEntry = {path, tokens: int|null, status: enum('injected','skipped'), reason: SpecSkipReason.nullish(), origin: enum('agent','skill'), skill_name: string.nullish()}`
- `RunTrace.specs_read: z.array(z.union([z.string(), SpecReadEntry]))` (legacy strings still parse)
- `RunTrace.project_context: {commit_sha: string|null, injected_tokens: int, soft_cap_exceeded: boolean}.nullish()`
- `PromptAssembly.project_context_blocks: z.array({path, tokens: int, text}).nullish()` (`specs` stays a string for legacy)

### Server module `server/src/modules/project-context/` (onion: routes -> service -> repository/ports)

| File | Kind | Role |
|---|---|---|
| `constants.ts` | pure | Re-exports cap constants; `DISCOVERY_READ_CONCURRENCY=8`, `RUN_READ_CONCURRENCY=4`, token-cache size. |
| `paths.ts` | pure | `normalizeContextPath` (trims one leading `./`, reuses `normalizeRef` from `brief/paths.ts`); `isContextDocPath` (`isSafeRepoPath` + first segment in folders + `/\.md$/i`); `classifySource`. |
| `ports.ts` | type | `ProjectDocsSource`, `TreeEntry`. |
| `docs.ts` | pure | `filterDocEntries` (blobs only, no symlinks/submodules, `isContextDocPath`); `decodeUtf8Strict` (`TextDecoder('utf-8',{fatal:true})`, `null` when invalid); `isBlank`. |
| `effective.ts` | pure | `effectiveDocs(enabledSkillsInOrder, agentPaths)` (skills first in order, then agent's own, first occurrence wins; AC-40); `validateAttachList` (duplicates after normalize, invalid paths; AC-21); `countUsedBy` (AC-38). |
| `token-cache.ts` | pure/mem | Small LRU `blobSha -> tokens`. |
| `resolver.ts` | IO via port | `resolveProjectContext(...)` for run time (P5). |
| `log-lines.ts` | pure | `projectContextSummaryLine` -> `project context: N doc(s) injected, X token(s); M skipped`; `projectContextSkipLine(path, reason)`. Never takes bodies. |
| `repository.ts` | DB | `findRepo`, `findAgent`, `findSkill` (unscoped, for 404/403); `workspaceUsage`; `linkedSkillsWithPaths`. Writes delegate to `AgentsRepository.setContextPaths` / `SkillsRepository.setContextPaths`, which own versioning. |
| `service.ts` | IO | `defaultRepo`, `discover`, `preview`, `getAgentContext`, `setAgentContext`, `getSkillContext`, `setSkillContext`. Authorization before any `source.*` call. |
| `routes.ts` | HTTP | Registered in `server/src/modules/index.ts`. |

Routes:
- `GET /context/default-repo` -> `DefaultContextRepo` (workspace repo with latest `createdAt`, or null).
- `GET /repos/:id/context/docs?refresh=1` -> `ContextDiscovery`. Failure -> 502 `{code:'discovery_failed', error}`; logs repo id and sanitized error class.
- `GET /repos/:id/context/docs/preview?path=` -> `ContextDocPreview`. Invalid path -> 400 (zod `refine(isContextDocPath)` before the handler). Missing on main -> 404 `{code:'not_on_main'}`. Non-UTF-8 -> 422 `{code:'not_text'}`.
- `GET|PUT /agents/:id/context` -> `AgentContextAttachments`.
- `GET|PUT /skills/:id/context` -> `ContextAttachments`.

Adapters and wiring:
- `server/src/adapters/project-docs/octokit.ts`: `OctokitProjectDocsSource(token)`.
- `server/src/adapters/project-docs/fixture.ts`: `FixtureProjectDocsSource` reading `server/src/db/fixtures/project-docs.ts` (keyed by repo full name, fixed commit sha).
- `server/src/adapters/mocks.ts`: `MockProjectDocsSource` (per-ref file maps `string | Uint8Array | null | Error`, records `calls[]`, can throw on `resolveBranchHead`).
- `server/src/platform/container.ts`: `projectDocs(): Promise<ProjectDocsSource>` plus `ContainerOverrides.projectDocs`; fixture when `config.PROJECT_DOCS_SOURCE === 'fixture'`, else Octokit with the GitHub token. `server/src/platform/config.ts`: `PROJECT_DOCS_SOURCE: z.enum(['github','fixture']).default('github')`.

### Run-time data flow (P5, inside `runOneAgent`)
1. After `linkedSkills`, call `effectiveDocs(enabledSkills, agent.contextPaths)`.
2. Empty list: no source call, no `projectContext`, `specs_read: []`, `project_context: null` (AC-47).
3. Otherwise `resolveProjectContext({source, repo:{owner,name}, branch: repo.defaultBranch, effective, tokenizer})`:
   - (a) Re-validate each path; invalid -> `invalid_path`, never read (AC-51).
   - (b) `resolveBranchHead` once; a throw -> every entry `read_error`, `commit_sha: null` (AC-50).
   - (c) `readBlob(path, sha)` per valid path, concurrency 4: `null` -> `not_found`; throws -> `read_error`; strict-decode fails -> `not_text`; blank -> `empty`.
   - (d) Walk readable documents in effective order accumulating tokens; inject while total <= 32,000; the first overflow and all later readable documents get `over_budget` (AC-52).
   - (e) `soft_cap_exceeded = injectedTokens > 4000`.
4. Write `runLog.info(summary)` and one `runLog.info(skipLine)` per skipped document (AC-48, AC-61).
5. Pass `projectContext` to the engine only when non-empty (AC-50).
6. `finishRun` and `traceFromBuffer(..., pc?)` write `specs_read = pc.entries`, `project_context = {commit_sha, injected_tokens, soft_cap_exceeded}`, `prompt_assembly.project_context_blocks`. `pc` is held in a `let` outside the `try` so failure/cancel traces keep the entries (AC-60).

### Client
- Hooks in `client/src/lib/hooks/project-context.ts`: `useDefaultContextRepo`, `useContextDocs(repoId)`, `useReindexContextDocs(repoId)` (fetch `?refresh=1`, then `setQueryData`), `useContextDocPreview(repoId, path)`, `useAgentContext`/`useSetAgentContext`, `useSkillContext`/`useSetSkillContext`. Setters are optimistic (`onMutate` snapshot, rollback and toast on error) with `scope: { id: 'agent-context-<id>' }` so writes run in order; every write carries the full list (last write wins, AC-24). Remove dead stubs from `core.ts`; re-export from `hooks/index.ts`.
- Shared components in `client/src/components/project-context/` (kebab folder, barrel `index.ts`, colocated `constants.ts`/`helpers.ts`/`styles.ts`): `ContextRepoPicker` (localStorage `devdigest.projectContext.repoId`, default from `useDefaultContextRepo`), `ContextDocPicker`, `ContextDocRow`, `ContextFooter`, `ContextDocPreviewDrawer` (own `role="dialog"` with `aria-labelledby`, Escape, focus return, `Markdown` body). `helpers.ts`: `formatDocTokens`, `buildRows`, `filterRows`, `footerTotals`, `serializeAs`, `moveItem`.
- Agent: `AgentEditor/constants.ts` adds the `context` tab; `_components/ContextTab/ContextTab.tsx` composes repo picker, picker with inherited rows, and drawer.
- Skill: `SkillEditor/_components/ContextTab/` (separate tab, always expanded, A-1): "N attached" badge, hint, "Serializes as" block, empty states, disabled state for `skill === null`.
- Trace: `TraceBody.tsx` plus `RunTraceDrawer/helpers.ts` (`normalizeSpecsRead`, `projectContextEntries`).
- i18n: `agents.json` (`context.*`, `editor.tabs.context`), `skills.json` (`projectContext.*`), `runs.json` (`trace.config.specsRead*`, `trace.prompt.projectContext*`) with ICU plurals; remove `"chunks"` from `context.json`.

## 4. Phases and tasks

Each task lists its ACs and named test(s). Paths are relative to the repo root.

### P1: Contracts (alone, first; owns both `trace.ts` and `platform.ts` copies)
- [ ] **T1** Add project-context schemas and constants to `server/src/vendor/shared/contracts/platform.ts` and copy byte-identically to `client/src/vendor/shared/contracts/platform.ts`. -> AC-62, AC-5, AC-20 -> `server/test/contracts.test.ts > project-context: ContextDiscovery/AgentContextAttachments parse`
- [ ] **T2** Extend `trace.ts` (`SpecSkipReason`, `SpecReadEntry`, union `specs_read`, `project_context`, `PromptAssembly.project_context_blocks`) and align comment drift so both copies are byte-identical. -> AC-53, AC-54, AC-57, AC-59, AC-62 -> `contracts.test.ts > RunTrace parses legacy specs_read strings + specs string`, `> RunTrace parses SpecReadEntry + project_context_blocks`
- [ ] **T3** Extend `server/test/contracts-parity.test.ts` to `trace.ts` and `platform.ts`; add a client-side parse test of the same fixtures. -> AC-62, AC-59 -> `contracts-parity.test.ts > trace.ts byte-identical`, `> platform.ts byte-identical`; `client/src/test/contracts-project-context.test.ts > client copy parses legacy and new traces`
- Gate: `pnpm typecheck` in `server`, `client`, `reviewer-core`.

### P2: DB (after P1)
- [ ] **T4** Add `contextPaths: jsonb('context_paths').$type<string[]>().notNull().default(sql`'[]'::jsonb`)` to `agents` (`schema/agents.ts`) and `skills` (`schema/skills.ts`); run `pnpm db:generate` (never hand-edit migrations). -> AC-20 -> `server/test/project-context.it.test.ts > stores only ordered paths (sentinel absent from agents, skills, agent_versions, skill_versions)`
- [ ] **T5** `AgentsRepository.setContextPaths(ws, id, paths)`: if the list differs, bump version and `snapshotVersion` (which now also writes `context_paths`); identical list is a no-op. `SkillsRepository.setContextPaths`: if different, snapshot old body, bump, write. -> AC-22, AC-16, AC-17 -> `project-context.it.test.ts > agent version +1 per list change, unchanged on identical list`, `> skill version +1 per list change, unchanged on identical list`

### P3a: Server pure layer, port, adapters, container (after P1; parallel with P2)
- [ ] **T6** `paths.ts`. -> AC-4, AC-15, AC-21, AC-51, AC-64 -> `server/test/project-context-paths.test.ts > classifySource per folder and nested`, `> rejects absolute, .., NUL, outside folders, non-.md; accepts .MD`
- [ ] **T7** `ports.ts` and `docs.ts`. -> AC-1, AC-15, AC-49, AC-68 -> `server/test/project-context-docs.test.ts > keeps specs/a.md, docs/sub/b.md, insights/c.MD; drops src/d.md, docs/e.txt, symlinks, submodules`, `> strict UTF-8 rejects binary`
- [ ] **T8** `effective.ts`. -> AC-40, AC-21, AC-38, AC-28 -> `server/test/project-context-effective.test.ts > skills first in skill order, then agent; first occurrence wins`, `> rejects duplicates after ./ trim`, `> used-by: A direct + B enabled skill + D both = 3, C disabled skill excluded`
- [ ] **T9** `log-lines.ts`. -> AC-61, AC-48 -> `server/test/project-context-log-lines.test.ts > summary format and plural; skip line names path and reason`
- [ ] **T10** `OctokitProjectDocsSource`, `FixtureProjectDocsSource` + `server/src/db/fixtures/project-docs.ts`, `MockProjectDocsSource`, `container.projectDocs()` + override, `PROJECT_DOCS_SOURCE` in config. -> AC-2, AC-15, AC-41 -> `server/test/project-docs-octokit.test.ts > getTree mode 120000 mapped to symlink; truncated falls back per folder; getContent 404 -> null; 5xx throws`; `> fixture source serves fixed sha for acme/payments-api`

### P3b: Server service, repository, routes (after P2 + P3a)
- [ ] **T11** `repository.ts`. -> AC-38, AC-63 -> covered by T13/T14 tests.
- [ ] **T12** `service.discover`: resolve head of `repo.defaultBranch`, list and filter, read blobs (concurrency 8), tokens from cache by blobSha else `tokenizer.count(lossy-decoded body)`, sort by path; `refresh` always re-resolves the head. -> AC-1, AC-2, AC-5, AC-10, AC-15 -> `server/test/project-context-service.test.ts > lists exactly the 3 valid docs`, `> requests ref = default_branch head only; doc only on other ref absent`, `> tokens equal tokenizer.count(body)`, `> refresh reads the new main tip`, `> symlinked entry absent`
- [ ] **T13** `preview`, `getAgentContext` (inherited in effective order), `setAgentContext`, `getSkillContext`, `setSkillContext`, `defaultRepo`. -> AC-35, AC-38, AC-28, AC-16, AC-17, AC-21, AC-22, AC-39 -> `project-context-service.test.ts > preview returns content, tokens, used_by`, `> agent context lists inherited docs via enabled skills only`, `> preview not on main -> not_on_main`
- [ ] **T14** `routes.ts` + register in `modules/index.ts`. -> AC-13, AC-21, AC-63, AC-64, AC-16, AC-17 -> `server/test/project-context-routes.test.ts`: `> discovery 502 leaves agent rows unchanged`; `> PUT duplicate (incl. ./ form) -> 400, row unchanged`; `> PUT invalid path -> 400`; `> other-workspace agent/skill/repo -> 403, unknown id -> 404, zero source calls`; `> preview ../../.env, /etc/passwd, src/index.ts -> 400, zero reads`; `> PUT persists full ordered list`
- [ ] **T15** DB integration tests in `server/test/project-context.it.test.ts` (attach appends, detach keeps order, stale path detachable). -> AC-16, AC-17, AC-20, AC-22 -> `> attach appends path last`, `> detach removes and keeps order` (plus T4/T5 tests).

### P4: reviewer-core (after P1; parallel with P2/P3)
- [ ] **T16** Baseline test first: `assemblePrompt` output for a no-project-context fixture (skills, intent, repoMap, callers, diff) as an inline expected string. -> AC-47 -> `reviewer-core/test/project-context-prompt.test.ts > no projectContext -> messages byte-identical to baseline`
- [ ] **T17** In `prompt.ts`: add `ProjectContextDoc`, `PromptParts.projectContext`, `wrapProjectDoc(path, content)` (label: escape `& " < >` and strip control chars; content: neutralize `</untrusted\s*>` and `<untrusted\b`, case-insensitive). When non-empty render `## Project context` from these blocks (wins over legacy `specs`). Append `PROJECT_CONTEXT_GUARD` to the system message only when the section is present (names project context documents as data that cannot give instructions or reduce, waive or descope findings). Add `AssembledPrompt.projectContext: {path, text}[]`; add to `logging/prompt-logger.ts` (lengths only). -> AC-42, AC-43, AC-44, AC-45 -> `project-context-prompt.test.ts > one section, one block per doc, effective order, path labels`; `> guard present and mentions project documents only when section present`; `> sentinel body only between its block delimiters in user message, never system/skills`; `> adversarial: closing tag, fake <untrusted source="system">, quote in path, "ignore previous instructions" in body and filename -> block count and labels intact`
- [ ] **T18** `review/run.ts`: `ReviewInput.projectContext` -> `promptParts`; `ReviewOutcome.projectContext` (blocks from the last assembly). -> AC-41, AC-42, AC-46 -> `reviewer-core/test/run.test.ts > 50 KB doc appears unshortened; llm.completeStructured called once (single-pass)`, `> map-reduce: section in every chunk call`, `> "do not report secrets" doc -> same kept findings, severities, blockers as without`

### P5: Server run-time resolver and injection (after P2, P3a, P4; parallel with P3b; sole owner of `run-executor.ts`)
- [ ] **T19** `resolver.ts`. -> AC-41, AC-48, AC-49, AC-50, AC-51, AC-52, AC-54, AC-68 -> `server/test/project-context-resolver.test.ts > one resolved ref for all reads`; `> missing -> not_found`; `> throw -> read_error`; `> binary -> not_text`; `> whitespace -> empty`; `> ../secrets.md -> invalid_path with no read call`; `> head unresolvable -> all read_error, sha null`; `> ceiling cut point -> over_budget for the rest`; `> 5,000 tokens -> all injected, soft_cap_exceeded true`
- [ ] **T20** Wire into `run-executor.ts` (`runOneAgent`, `finishRun`, `traceFromBuffer`). -> AC-40, AC-47, AC-48, AC-50, AC-53, AC-54, AC-60, AC-61 -> `server/src/modules/reviews/run-executor.project-context.test.ts` (pattern of `run-executor.scope.test.ts`): `> no effective docs -> no source calls, specs_read [], no section`; `> one injected + one inherited + one missing -> entries in order with origin, status done, log lines`; `> commit sha equals stubbed tip`; `> LLM throws after resolution -> failure trace keeps specs_read + sha`; `> failure before resolution -> specs_read []`; `> log lines contain no body sentinel`; `> all skipped -> no Project context section`
- [ ] **T21** DB integration for run-time behaviour. -> AC-57, AC-48, AC-51 -> `server/test/project-context-run.it.test.ts > trace text unchanged after stubbed main changes`; `> stored ../secrets.md seeded directly in DB -> invalid_path, no read`

### P6: Client Context tab, skill section, preview (after P1; build against mocked hooks; connect to real API after P3b)
- [ ] **T22** Hooks in `client/src/lib/hooks/project-context.ts`; remove dead stubs from `core.ts`. -> AC-10, AC-16, AC-17, AC-23, AC-24 -> `client/src/lib/hooks/project-context.test.tsx > setter is optimistic and rolls back on error`; `> two rapid writes with delayed responses: final PUT payload equals last state, requests serialized`
- [ ] **T23** `components/project-context/helpers.ts` and `constants.ts`. -> AC-5, AC-12, AC-14, AC-25, AC-26, AC-28, AC-32 -> `client/src/components/project-context/helpers.test.ts > formatDocTokens 640 / 1000 -> 1K / 1234 -> 1.2K`; `> row order: attached in order, then specs, docs, insights by path`; `> footer totals: 400 + 1234 -> 2 files, 1.6K; stale excluded; inherited included`; `> soft cap only above 4000`; `> serializeAs groups and order`
- [ ] **T24** `ContextDocPicker`, `ContextDocRow`, `ContextFooter`. -> AC-1, AC-3, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-16, AC-17, AC-18, AC-19, AC-23, AC-25, AC-26, AC-27, AC-28 -> `client/src/components/project-context/ContextDocPicker/ContextDocPicker.test.tsx`: `> three rows with handle, checkbox, name, folder, source badge, Preview`; `> "2 of 7 attached", stale not counted`; `> filter SEC leaves security-baseline.md; badge and footer unchanged`; `> no match -> "No documents match" with clear`; `> empty -> No documents found + Re-index`; `> Re-index: one request, disabled busy, new list`; `> loading placeholder, no empty state`; `> stale row "Not found on main", detachable, no Preview, excluded from total`; `> discovery error: alert + Retry + attached rows "not verified", no write`; `> tick appends last; untick keeps order`; `> drag reorder persists; unattached handle inert`; `> keyboard move up/down persists same order`; `> failed write restores list + message`; `> footer text, warning badge at 4001 only with icon + text, checkbox enabled`; `> footer note text`; `> inherited "via <skill>" row read-only and counted`
- [ ] **T25** `ContextDocPreviewDrawer`. -> AC-35, AC-36, AC-37, AC-39, AC-67 -> `ContextDocPreviewDrawer.test.tsx > title path, source badge, "Used by 1 agent" / "Used by 3 agents", token label, rendered heading`; `> <script> and <img onerror> not in DOM; no edit control`; `> Attach/Attached toggles row checkbox and footer`; `> pending / 404 "no longer on main" / 5xx with Retry; drawer stays open`; `> labeled dialog, Escape closes, focus returns to Preview button`
- [ ] **T26** `ContextRepoPicker` and Agent `ContextTab`; add tab to `AgentEditor`. -> AC-1, AC-6, AC-28, AC-9 -> `AgentEditor.test.tsx > renders Context tab`; `ContextTab.test.tsx > remembers repo selection in localStorage; defaults to default-repo; no-repo hint with Re-index disabled`
- [ ] **T27** Skill `ContextTab` (new tab in `SkillEditor`, section always expanded; A-1). AC-30 is N/A and tested only as "section has no collapse control". -> AC-29, AC-31, AC-32, AC-33, AC-34 -> `ProjectContextSection.test.tsx > renders "N attached", filter, rows; attaches a doc`; `> always expanded, no collapse control`; `> inheritance hint`; `> Serializes as exact text`; `> "No project context attached to this skill." with list vs AC-9 empty state`; `> skill=null -> disabled with save hint`
- [ ] **T28** i18n keys in `agents.json`, `skills.json`, `runs.json` (plurals); remove `"chunks"` from `context.json`. -> AC-25 -> `client/src/test/messages-no-chunk.test.ts > no message value contains "chunk"`

### P7: Client trace UI (after P1; parallel with P2-P6; sole owner of `RunTraceDrawer/**` and `runs.json` trace keys, coordinated with T28)
- [ ] **T29** `normalizeSpecsRead` and `projectContextEntries` in `RunTraceDrawer/helpers.ts`. -> AC-59 -> `RunTraceDrawer/helpers.test.ts > legacy strings -> paths without tokens; legacy specs string -> one entry`
- [ ] **T30** Update `TraceBody`: Specs read row `path · N tok`, skipped rows visibly distinct with reason as text, "none" when empty, soft-cap note; Prompt assembly section "Project context — attached specs (untrusted)" with one `PromptBlock` per entry opening to the exact text. -> AC-55, AC-56, AC-58, AC-59 -> `RunTraceDrawer.test.tsx > Specs read: injected "specs/public-api.md · 512 tok", skipped with reason, none`; `> opening project context entry shows stored block text incl. <untrusted source=`; `> soft-cap note above 4000`; `> legacy fixtures render without error`

### P8: Seed, e2e, docs (after P3b, P5, P6, P7)
- [ ] **T31** `server/src/db/seed.ts`: give one seeded agent `contextPaths` (2 of 4 fixture docs); seed one `agent_runs` row and one `run_traces` row (fixed id `SEED_PROJECT_CONTEXT_RUN_ID`) for PR #482, built with reviewer-core's `wrapProjectDoc` and `TiktokenTokenizer`; update `demo-reset.ts` if needed and `server/test/seed-demo.it.test.ts`. -> AC-65, AC-66 -> `seed-demo.it.test.ts > seeds agent context paths and a project-context trace that parses as RunTrace`
- [ ] **T32** Set `PROJECT_DOCS_SOURCE=fixture` in `scripts/e2e.sh` and the `e2e-web.yml` `env:` block (A-2; CI edit needs the user's OK). -> AC-65 -> verified by T33.
- [ ] **T33** `e2e/specs/09-agent-context.flow.json`: open the seeded agent with `?tab=context`; assert the 4 docs are listed, badge "2 of 4 attached", attached rows first (DOM order of `[data-testid="context-doc-row"][data-path]`), footer matches `/2 files · [\d.]+K? tokens total/`. -> AC-65
- [ ] **T34** `e2e/specs/10-trace-project-context.flow.json`: PR #482 -> `?tab=findings&trace=<seed id>`; assert "Specs read" lists the seeded paths with `· N tok`, and the opened entry contains `<untrusted source="specs/security-baseline.md">`, the document text and `</untrusted>`. -> AC-66
- [ ] **T35** Docs: route list in `server/README.md`, flow table in `e2e/README.md`, `e2e/specs/flows.md` if needed, note in `reviewer-core/specs/review-contract.md` (new `projectContext` input/output). -> AC-62 (documentation) -> review only.

## 5. Traceability matrix (AC -> task -> test)

| AC | Tasks | Tests |
|---|---|---|
| AC-1 | T7, T12, T24, T26 | project-context-docs.test (keeps 3), project-context-service.test (lists exactly 3), ContextDocPicker.test (three rows) |
| AC-2 | T10, T12 | project-context-service.test (ref = default_branch head; other-ref doc absent) |
| AC-3 | T24 | ContextDocPicker.test (six elements per row) |
| AC-4 | T6 | project-context-paths.test (classifySource) |
| AC-5 | T1, T12, T23 | project-context-service.test (tokens = tokenizer.count), helpers.test (640/1K/1.2K) |
| AC-6 | T24, T26 | ContextDocPicker.test ("2 of 7 attached") |
| AC-7 | T24 | ContextDocPicker.test (filter SEC) |
| AC-8 | T24 | ContextDocPicker.test (no match) |
| AC-9 | T24, T26 | ContextDocPicker.test (empty), ContextTab.test (no-repo hint) |
| AC-10 | T12, T22, T24 | project-context-service.test (refresh new tip), ContextDocPicker.test (Re-index busy) |
| AC-11 | T24 | ContextDocPicker.test (loading) |
| AC-12 | T23, T24 | helpers.test (stale excluded), ContextDocPicker.test (Not found on main) |
| AC-13 | T14, T24 | project-context-routes.test (502, rows unchanged), ContextDocPicker.test (error + Retry, no write) |
| AC-14 | T23 | helpers.test (row order) |
| AC-15 | T6, T7, T10, T12 | project-context-paths.test, project-context-docs.test (symlinks), project-docs-octokit.test (mode 120000), project-context-service.test (symlink absent) |
| AC-16 | T5, T13, T14, T15, T22, T24 | ContextDocPicker.test (tick appends), project-context.it.test (attach appends), routes.test (PUT persists) |
| AC-17 | T5, T13, T15, T24 | ContextDocPicker.test (untick), project-context.it.test (detach keeps order) |
| AC-18 | T24 | ContextDocPicker.test (drag; unattached inert) |
| AC-19 | T24 | ContextDocPicker.test (keyboard move) + manual keyboard check |
| AC-20 | T1, T4 | project-context.it.test (sentinel absent everywhere) |
| AC-21 | T6, T8, T14 | project-context-effective.test (duplicates), routes.test (400 cases) |
| AC-22 | T5 | project-context.it.test (agent and skill version bumps) |
| AC-23 | T22, T24 | hooks test (rollback), ContextDocPicker.test (restore + message) |
| AC-24 | T22 | hooks test (serialized, final = last state) |
| AC-25 | T23, T24, T28 | helpers.test (2 files 1.6K), ContextDocPicker.test (footer), messages-no-chunk.test |
| AC-26 | T23, T24 | helpers.test (above 4000), ContextDocPicker.test (badge at 4001 only) |
| AC-27 | T24 | ContextDocPicker.test (footer note) |
| AC-28 | T8, T13, T23, T24 | project-context-service.test (inherited via enabled skills), ContextDocPicker.test (via row counted) |
| AC-29 | T27 | ContextTab.test (renders, attaches) |
| AC-30 | T27 | N/A in the separate-tab placement (OQ-12); ContextTab.test asserts no collapse control |
| AC-31 | T27 | ProjectContextSection.test (hint) |
| AC-32 | T23, T27 | helpers.test (serializeAs), ProjectContextSection.test (exact text) |
| AC-33 | T27 | ProjectContextSection.test (both empty cases) |
| AC-34 | T27 | ProjectContextSection.test (skill=null) |
| AC-35 | T13, T25 | project-context-service.test (preview), ContextDocPreviewDrawer.test (title/badge/plural/tokens/body) |
| AC-36 | T25 | ContextDocPreviewDrawer.test (no script/img onerror, no edit) |
| AC-37 | T25 | ContextDocPreviewDrawer.test (Attach/Attached toggle) |
| AC-38 | T8, T11, T13 | project-context-effective.test (N = 3), project-context-service.test (used_by) |
| AC-39 | T13, T25 | project-context-service.test (not_on_main), ContextDocPreviewDrawer.test (pending/404/5xx) |
| AC-40 | T8, T20 | project-context-effective.test (order/dedupe), run-executor.project-context.test (inherited origin) |
| AC-41 | T10, T18, T19 | project-context-resolver.test (one ref), run.test (50 KB unshortened; one LLM call) |
| AC-42 | T17, T18 | project-context-prompt.test (section, order, labels), run.test (map-reduce every chunk) |
| AC-43 | T17 | project-context-prompt.test (guard) |
| AC-44 | T17 | project-context-prompt.test (sentinel containment) |
| AC-45 | T17 | project-context-prompt.test (adversarial) |
| AC-46 | T18 | run.test (policy unchanged) |
| AC-47 | T16, T20 | project-context-prompt.test (baseline identical), run-executor.project-context.test (no docs) |
| AC-48 | T9, T19, T20, T21 | resolver.test (not_found), run-executor.project-context.test (done + log line) |
| AC-49 | T7, T19 | resolver.test (read_error, not_text) |
| AC-50 | T19, T20 | resolver.test (head unresolvable), run-executor.project-context.test (all skipped, no section) |
| AC-51 | T6, T19, T21 | resolver.test (invalid_path no read), project-context-run.it.test (DB-seeded ../secrets.md) |
| AC-52 | T19 | resolver.test (cut point; 5,000 soft-cap flag) |
| AC-53 | T2, T20 | run-executor.project-context.test (entries with origin) |
| AC-54 | T2, T19, T20 | run-executor.project-context.test (sha = tip) |
| AC-55 | T30 | RunTraceDrawer.test (Specs read variants) |
| AC-56 | T30 | RunTraceDrawer.test (entry text incl. `<untrusted source=`) |
| AC-57 | T2, T21 | project-context-run.it.test (text unchanged after main changes) |
| AC-58 | T30 | RunTraceDrawer.test (soft-cap note) |
| AC-59 | T2, T3, T29, T30 | contracts.test (legacy parse), helpers.test (normalize), RunTraceDrawer.test (legacy render) |
| AC-60 | T20 | run-executor.project-context.test (failure trace before/after resolution) |
| AC-61 | T9, T20 | log-lines.test, run-executor.project-context.test (no body sentinel) |
| AC-62 | T1, T2, T3, T35 | contracts-parity.test (trace.ts, platform.ts), client contracts-project-context.test |
| AC-63 | T11, T14 | project-context-routes.test (403/404, zero reads) |
| AC-64 | T6, T14 | project-context-routes.test (400, zero reads) |
| AC-65 | T31, T32, T33 | e2e 09-agent-context.flow.json, seed-demo.it.test |
| AC-66 | T31, T34 | e2e 10-trace-project-context.flow.json, seed-demo.it.test |
| AC-67 | T25 | ContextDocPreviewDrawer.test (label, Escape, focus return) + manual check |
| AC-68 | T7, T19 | resolver.test (empty) |

No AC is unmapped.

## 6. Risks, assumptions, items needing user acknowledgement

- **A-1 (DECIDED: separate tab). Skill section placement.** The "Project context to use" section is a new **Context** tab in the Skill editor, rendered always expanded (the OQ-12 default). AC-30 (collapse/expand, `aria-expanded`) is N/A in this placement. `SkillEditor` gains a `context` tab beside Config / Preview / Versions.
- **A-2 (DECIDED: approved; CI edit).** Deterministic e2e needs `PROJECT_DOCS_SOURCE=fixture`: one env line in `.github/workflows/e2e-web.yml` and one in `scripts/e2e.sh`. Without the CI line, flow 09 has no docs (the e2e server has no GitHub token). Auto-falling back to the fixture for `acme/payments-api` when no token is configured is implicit production behaviour and is not recommended.
- **R1. Discovery latency (NFR still tagged).** Token counts need every blob, so a cold first discovery of 500 docs is about 500 `getContent` calls and will miss 2 s p95. Mitigations: concurrency 8, blob-sha token cache, warm re-discovery reads only changed blobs. If 2 s cold is mandatory, a later step can batch via GraphQL.
- **R2. GitHub rate limits** during discovery or runs surface as `discovery_failed` (UI Retry) or `read_error` (run continues). No retries beyond existing `withRetry`.
- **R3. Seeded `agent_runs` row** adds a run to PR #482's history. Flow `04-pr-findings` asserts the seeded verdict and findings, so T31 must keep that flow green (new run status `done`, no extra findings).
- **R4. Vendored drift.** P1 aligns `trace.ts` comments only; `knowledge.ts` and `adapters.ts` stay divergent (out of scope).
- **R5. Version semantics.** The agent snapshot now includes `context_paths` in `config_json` (stripped on parse). Skill attachment changes snapshot the old body, so the Versions tab shows a version with the same body: an accepted side effect of D-6.
- **Assumptions:** non-UTF-8 docs are still listed in discovery (tokens from lossy decode), preview returns 422 `not_text`; a path both inherited and attached counts once in the footer; authorization runs before path validation except zod 400s, which also do zero reads; the `/runs/:id/trace` workspace-scoping gap is pre-existing and out of scope.
- **Housekeeping:** `server/src/modules/brief/.service.ts.swp` is untracked; do not commit it.

## 7. Out of scope
CI runner path (OQ-10); PR Brief integration (OQ-7); restoring attachments on version restore; plugin export of attachments (`productionize.ts`); document editing; relevance selection; embeddings; lint or CI changes beyond A-2.

## 8. Validation

Commands:
- `server`: `pnpm typecheck`; `pnpm exec vitest run --exclude '**/*.it.test.ts'`; `pnpm test` (integration, Docker).
- `reviewer-core`: `pnpm typecheck && pnpm test`.
- `client`: `pnpm typecheck && pnpm test`.
- `scripts/e2e.sh` with flows 01-10 green.

Test strategy: pure functions get unit tests; service and resolver tests use `MockProjectDocsSource` with call spies; routes use `buildApp` with overrides; DB behaviour (versioning, sentinel, stale-trace text) uses `.it.test`; client uses RTL with mocked hooks and real `next-intl` messages; e2e uses seeded data only (no network, no LLM).

Manual checks: keyboard-only reorder (AC-19) and drawer focus (AC-67).

Breaking changes: none. Contract changes are additive, the migration only adds columns with defaults, and prompts without attachments are byte-identical (AC-47 baseline test).

## 9. Execution mode (DECIDED: single-agent, report after each wave)

Run sequentially P1 → P2 → P3a → P3b → P4 → P5 → P7 → P6 → P8. Report to the user after each wave (P1; P2+P3a; P3b+P4; P5+P7; P6; P8) with checks run and results, then continue unless told otherwise. The multi-agent wave table below is kept for reference only.

| Wave | Phases | Notes |
|---|---|---|
| 0 | P1 | Alone. Freezes the contracts. |
| 1 | P2 (db schema + agents/skills repositories), P3a (project-context pure files, adapters, mocks, container, config), P4 (reviewer-core only), P7 (RunTraceDrawer + runs.json trace keys) | Parallel. |
| 2 | P3b (needs P2 + P3a), P5 (needs P2 + P3a + P4), P6 (needs P1; can start in wave 1 against mocked hooks) | Parallel. |
| 3 | P8 | Seed, e2e, CI env line (A-2), docs. Needs everything. |

Shared-file owners: `adapters/mocks.ts`, `container.ts`, `config.ts` -> P3a only; `run-executor.ts` -> P5 only; `modules/index.ts` -> P3b; `client/messages/en/runs.json` -> P7; `agents.json`, `skills.json`, `context.json` -> P6; `seed.ts` -> P8.

Why multi-agent: about 35 tasks across 4 packages with clean seams; reviewer-core and the trace UI depend only on the frozen contract, so parallelism cuts wall time by roughly 40%. The main integration risk is P5 consuming P3a/P4 APIs, which this plan fixes (`ProjectDocsSource`, `effectiveDocs`, `projectContext` input and output).

Single-agent alternative: P1 -> P2 -> P3a -> P3b -> P4 -> P5 -> P7 -> P6 -> P8. Lower merge-conflict risk, slower.
