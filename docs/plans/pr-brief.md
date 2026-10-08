# Plan: PR Why + Risk Brief (SPEC-01)

Spec: `specs/01-pr-brief.md` (status: approved, revision 2 after cross-model review; see `docs/plans/pr-brief-cross-review.md`). Branch: `feat/pr-brief`.
Execution mode: **multi-agent** (decided by the user; see section 9). R1-R3 acknowledged and accepted by the user.
Author: `implementation-planner` agent (read-only); saved by the caller.

## 0. Spec gate

- Spec revision 2, status `approved`. 84 ACs: AC-1..AC-55 keep their ids, AC-56..AC-84 are new, none were removed. Each AC maps to at least one task (section 4).
- Decisions D-1..D-8 (OQ-1..OQ-6 resolved, plus D-7 and D-8). Older references to "OQ-n" in this plan mean D-n:
  - **D-1:** focus items only use PR diff files. Risks may also cite blast caller files.
  - **D-2:** the live IntentBlock and BlastRadiusBlock move inside the card. A trimmed snapshot is stored, and an advisory "inputs changed" hint shows when live data differs from it (AC-78).
  - **D-3:** contract shape: nullable `intent`/`blast`, optional `history`, nullable usage/cost, ISO-8601 UTC `generated_at`, canonical `missing` order, `line_adjusted` set only by grounding, post-grounding validation.
  - **D-4:** shared `Risk` is NOT tightened. The model output schema restricts `kind` to 7 values. Brief risks get ">= 1 file_refs" from grounding plus the server-only `PrBriefStored` schema.
  - **D-5:** no model fallback.
  - **D-6:** 60 s POST target, model call capped at 50 s.
  - **D-7:** one generation = one `completeStructured` call, `maxRetries: 1`, up to 2 `schema_attempts`.
  - **D-8:** the loader drops deleted, pure-rename and binary files (diff-facts enforces this, see 1a).
- OQ-7..OQ-12 are still `[NEEDS CLARIFICATION]`. The caller accepted the proposed defaults for planning:
  - OQ-7: hunk new-side ranges, context lines included, are the navigable ranges.
  - OQ-8: a degraded brief replaces a complete one.
  - OQ-9: a healthy index with 0 callers counts as available, not `blast` missing.
  - OQ-10: source labels are `#<n>` or a repo-relative doc path, plus a status.
  - OQ-11: the note lists both absent and failed sources; the chips show the difference.
  - OQ-12: no local tracing of prompt bodies.
- Housekeeping, not blocking: `spec-creator` removes the OQ-7..12 tags after the user confirms.

## 1. Research findings (spec "Research suggestions")

### 1a. How `loadDiff` exposes line ranges and change status

- `loadDiff` (`server/src/modules/reviews/diff-loader.ts`) returns a `UnifiedDiff` (`server/src/vendor/shared/adapters.ts:195-208`):
  - `raw: string` (the full diff text, bodies included)
  - `files[]: {path, additions, deletions, hunks: DiffHunk[]}`
  - `DiffHunk = {file, oldStart, oldLines, newStart, newLines, newLineNumbers[]}`
- The source is `git diff base...head` (`adapters/git/simple-git.ts:125`). If that fails or is empty, it falls back to rebuilding the diff from `pr_files.patch`.
- **New-side ranges:** each hunk with `newLines > 0` covers `[newStart, newStart + newLines - 1]`. The range includes context lines, which matches what Files changed renders.
- **Hunk-header context:** the text after `@@ … @@` is not stored in `DiffHunk`. Only `raw` holds hunk bodies and that context text.
  - **Rule:** the brief builder never receives a `UnifiedDiff`. It only gets `DiffFact[]` built by `diff-facts.ts`, so leaking `raw` is impossible at the type level.
- **Change status:** there is no status field anywhere, and `pr_files` has no status column. None is derived or sent (spec non-goal, AC-20).
- **Deleted files.** On the `git diff` path they never appear: `parseUnifiedDiff` takes the path only from `+++ b/…`, keeps `''` for `+++ /dev/null`, and filters those entries (`diff-parser.ts:41-42,78`). On the `pr_files` fallback, `diffFromPrFiles` writes `+++ b/<path>` for every patch, so a deleted file DOES appear, with only `newLines = 0` hunks. **Rule:** `diffFacts` drops any file with no hunk where `newLines > 0`. This makes D-8 and AC-60 hold on both paths.
- **Pure renames and binary files** with no `---`/`+++` lines are dropped the same way.
- **Renames that have hunks** appear under the new path only. This matches the spec: "grounded against the new path only".
- **Consequence:** deleted, pure-rename and binary files are never in the diff facts, so grounding drops refs to them (AC-60). A rename with hunks is keyed by its new path only (the GitHub `filename` or `+++ b/`); the old path is not stored anywhere (AC-61).
- **Loaded vs unavailable.** `getPullDetail` never throws on GitHub failure; it serves the persisted rows (`pulls/service.ts:320`). So the only usable signal is the `pr_files` row count after the import. See T10 for the classification rule.
- A brand-new PR may have an empty `pr_files` table and no head commit in the clone, so the diff can come back empty. `blast/files.ts` already handles this: it imports the PR detail once and then reloads. The brief reuses that logic (T10).

### 1b. Whether `completeStructured` reports attempts

- **Reported** by OpenAI (`server/src/adapters/llm/openai.ts:124`), Anthropic (`anthropic.ts:137`) and OpenRouter (`reviewer-core/src/llm/openrouter.ts:109`): `attempts` is the index of the schema-validation attempt, 1..`maxRetries + 1` (default `maxRetries` is 2, so up to 3).
- **Not counted:** transport retries inside `withRetry` (up to 3 retries on 429, 5xx or network errors, backoff up to 8 s, `platform/resilience.ts`).
- **On a final validation failure** the adapters throw `ExternalServiceError` with no attempt count. As in Intent (`intent/service.ts:330`), the failure is reported as a lower bound of 1 attempt.
- `MockLLMProvider` always returns `attempts: 1` and records every call in `calls[]`.
- With the brief's `maxRetries: 1`, OpenAI reports `attempts` in 1..2 (`openai.ts:96,124`). This is `meta.schema_attempts`. When schema validation fails for good, the log uses a lower bound of 2 (both attempts were used).
- Adapters turn missing usage into `0` (`openai.ts:112-113`). The brief therefore maps `tokensIn === 0` / `tokensOut === 0` to `null`; a successful structured call never really reports 0. `costUsd` is already `number | null` (AC-70).
- The schema-failure `ExternalServiceError` carries `details.raw` (raw model output), and SDK errors may echo request content. The brief therefore never logs `err.message` or `err.details` (AC-67, T40).
- `container.llm(id)` throws `ConfigError` when the key is missing and has no fallback (`platform/container.ts:163-193`), which matches D-5 and AC-81.
- `wrapUntrusted` (`reviewer-core/src/prompt.ts:48`) escapes only `</untrusted>`, not a fake opening tag, so it fails AC-65/66. The brief uses its own `wrapBlock` (T38).

### 1c. Other facts verified in code

- **No migration needed.** `pr_brief(pr_id uuid PK -> pull_requests.id ON DELETE CASCADE, json jsonb NOT NULL)` already exists (`server/src/db/schema/reviews.ts:75-80`, `0000_init.sql:211`). The schema is untouched, `pnpm db:generate` is not run, migration files are not edited. `demo-reset.ts:35` already deletes `pr_brief` rows.
- **`risk_brief` defaults to `openai`/`gpt-4.1`** (`contracts/platform.ts:64`). It resolves through `resolveFeatureModel` (`settings/feature-models.ts`).
- **Nothing parses `PrBrief` today.** It is only re-exported as a type in `client/src/lib/types.ts:36`, so relaxing it is safe.
- **Parity test exists:** `server/test/contracts-parity.test.ts` byte-compares the two `brief.ts` copies.
- **reviewer-core CI** runs whenever `server/src/vendor/shared/**` changes (`.github/workflows/reviewer-core.yml`), so its typecheck must pass.
- **Test logger is disabled.** `buildApp` sets `logger: false` under `LOG_LEVEL=silent`, so route tests can't read log output. Log assertions go through `vi.mock` of the brief log-line module (T9, T13).
- **`IntentBlock` and `BlastRadiusBlock` are self-contained cards** with their own hooks. The `brief` keys `noRisks`, `unavailable`, `unavailableHint` and `block.*` are not used anywhere in client code, so their text can be updated safely.
- **The `Button` primitive** (`client/src/vendor/ui/primitives/Button.tsx`) sets `disabled` while `loading` but has no `aria-busy`. `vendor/ui` is read-only, so `aria-busy` goes on a wrapper.
- **DiffTab has no navigation input.** `FileCard` decides its initial open state once (`defaultOpen ?? lines <= AUTO_EXPAND_MAX_LINES`). `CodeLine` has no ref and no highlight. `SmartDiffGroup` collapses `docs` and `boilerplate` by default.
- **`RefResolver.resolveRefs`** never throws for the issue or the doc (errors become `error`/`unavailable` statuses). It fetches at most one plan/spec doc and truncates it to 32 KB.
  - `container.github()` can throw when no token is configured. The brief catches this and labels the referenced sources `error` using the exported `extractIssueRef` and `extractDocPaths`.

## 2. Implementation strategy

### Server module `server/src/modules/brief/` (new), modelled on `intent/` and `blast/`

| File | Kind | Role |
|---|---|---|
| `constants.ts` | pure | `BRIEF_BUDGET_TOKENS=8000`, `BRIEF_FRAMING_RESERVE=1500`, section ceilings 300/400/100/800/700/1200/500/2500 (table below), `BRIEF_MISSING_ORDER`, `BRIEF_RATE_LIMIT_MS=30_000`, `BRIEF_LLM_TIMEOUT_MS=50_000`, `BRIEF_MAX_RETRIES=1`, `MAX_BLAST_CALLERS=25`, output caps (summary 600, risks 8, explanation 400, focus 7, reason 200), `RISK_KINDS` (7), `TRUNCATION_MARKER`. |
| `schema.ts` | pure | `BriefModelOutput` zod schema. No `.max()`, `.min()` or `.optional()`, for strict-mode safety. `kind` is an enum of `RISK_KINDS` (AC-79); `severity` uses the shared `RiskSeverity`. No `line_adjusted` field (AC-69). Also exports the server-only `PrBriefStored = PrBrief.extend({ risks: z.array(Risk.extend({ file_refs: z.array(z.string()).min(1) })) })` (AC-68, AC-84). |
| `diff-facts.ts` | pure | `diffFacts(files: UnifiedDiff['files']): DiffFact[]` (takes `files`, never the whole `UnifiedDiff`, so `raw` is out of reach) produces `{path, role, additions, deletions, ranges: [s, e][]}` with no status. It drops files with no `newLines > 0` hunk (AC-60) and unsafe paths (`isSafeRepoPath`, AC-63). Also `diffStats(facts): BriefDiffStats`. |
| `prompt.ts` | pure | `buildBriefPrompt(input, opts?)` returns `{ok: true, messages, estimatedTokens, truncated, missing} | {ok: false, reason: 'input_over_budget', estimatedTokens}`. Per-section ceilings on escaped content with no borrowing, a fixed truncation order, markers, a final exact-payload re-measure, `wrapBlock` (T38) for every untrusted block, canonical `missing` order, and a brief-specific injection guard. `opts` overrides budget and ceilings for tests. |
| `grounding.ts` | pure | `clampOutput(out)` applies the caps. `groundBrief(out, {diff: Map<path, DiffFact>, blastFiles: Set<string>})` returns `{risks, review_focus, counts}`. It stores the canonical allow-list key, never the model string (AC-62), and rejects unsafe model paths (AC-63). |
| `log-line.ts` | pure | `briefCallsLabel({calls: 0|1, outcome})` gives `brief=1 ok`, `brief=1 invalid_output`, `brief=1 provider_error`, `brief=1 timeout`, `brief=0 provider_unavailable` or `brief=0 input_over_budget`. `schema_attempts` is a separate field (D-7). `briefLogFields(meta)` builds structured fields. `logBriefGeneration(log, fields)` is the only place that writes the log line. |
| `repository.ts` | DB | `BriefRepository.getBrief(prId)` and `upsertBrief(prId, json)` (`onConflictDoUpdate` on `prId`). |
| `service.ts` | IO | `BriefService.generate(...)`: gathers inputs, builds the prompt, makes ONE `completeStructured` call wrapped in `withTimeout`, then validates, clamps, grounds, composes `PrBrief`, validates it with `PrBriefStored` (AC-68), upserts, and returns `{status, outcome, brief?, meta}`. Maps errors with `classifyLlmError` (T40). Takes an injectable `now()` for `generated_at`. Dependencies are injected so tests can stub them. Never writes on failure. Never imports `IntentService`. |
| `paths.ts` | pure | `isSafeRepoPath(p)`: false for NUL, a leading `/` or `\`, a drive letter (`^[A-Za-z]:`), or a `..` segment split on `/` or `\`. `normalizeRef(p)` trims one leading `./` (AC-63). |
| `routes.ts` | HTTP | `GET` and `POST /pulls/:id/brief`, `BriefResponseSchema`, and the in-memory per-PR limiter (same pattern as `intent/routes.ts:78,139-153`). |

Shared change: `server/src/modules/blast/files.ts` gains `changedDiffForPr()`, which returns `{status: 'loaded', diff: UnifiedDiff} | {status: 'unavailable', reason: string}`. A `loaded` diff may have zero files. It keeps the existing in-flight dedupe and PR-detail import. `changedFilesForPr()` maps `loaded` to paths and `unavailable` to `[]`, with no behaviour change.

Registration: `server/src/modules/index.ts` gets one import and one `brief` entry.

### POST `/pulls/:id/brief` data flow

1. `getContext`. Load the PR. Return 404 if it is missing (AC-57) and 403 if it is in another workspace (AC-58). Both answers come before any GitHub call, DB write or limiter admission.
2. Limiter check-and-set in one synchronous function `admit(prId, now)`, with no `await` between check and set. Every admitted request counts, whatever its outcome (AC-31). A 429 returns `retry_after = Math.max(1, Math.ceil(remainingMs / 1000))`, the same value in `Retry-After` (AC-72), and logs prId plus `step: 'brief'`.
3. `resolveFeatureModel(container, ws, 'risk_brief')`, then `container.llm(provider)`. If that throws, return 502 `{error: "Risk Brief model (Settings > Models > Risk Brief): <provider> is not configured", retry_after}`, make no call with any other provider, and log `brief=0 provider_unavailable` (D-5, AC-81).
4. Gather inputs (all fail-open):
   - Intent: `IntentRepository.getIntent`, read only. No row or empty summary adds `intent` to missing.
   - Diff: `changedDiffForPr` -> `diffFacts`. `unavailable` adds `diff` to missing (AC-48). `loaded` with 0 facts gives `diff_stats.files = 0`, keeps `diff` out of missing, and returns `review_focus: []` (AC-59).
   - Blast: `repoIntel.getBlastRadius(repoId, paths)` -> `buildBlastRadius`.
     - `blast` is missing when it throws, when `paths` is empty, or when `degraded && changed_symbols.length === 0` (AC-44).
     - `blast_degraded_reason` is recorded whenever the result is degraded.
   - Refs: `RefResolver.resolveRefs`.
     - `linked_issue` is missing unless a linked issue was fetched.
     - `specs` is missing unless a plan or spec doc was fetched.
     - If `container.github()` throws, referenced labels get status `error` (AC-47).
   - `description` is missing when the body is empty after trimming.
   - `sources` = PR title, PR body and Changed files (as in `IntentService.buildSources`) plus the resolved refs. Only labels and statuses are kept (AC-46).
5. `buildBriefPrompt` -> messages and input metadata. `{ok: false}` -> 502 `{error, retry_after}`, no model call, no write, log `brief=0 input_over_budget` (AC-64).
6. Exactly one model call:

   ```ts
   withTimeout(llm.completeStructured({ model, schema: BriefModelOutput, schemaName: 'PrBriefOutput', messages, temperature: 0, maxRetries: 1, timeoutMs: 45_000 }), BRIEF_LLM_TIMEOUT_MS)
   ```

   An error or a timeout returns 502 `{error, retry_after}` with no DB write (AC-18, AC-23, AC-33, AC-82). The error body uses a fixed per-outcome message and never the provider text (AC-67).
7. `clampOutput` -> `groundBrief` -> compose `PrBrief`. The `intent` and `blast` fields are snapshots (blast trimmed to what the model saw). `meta` holds:
   - the head SHA read in step 1
   - `generated_at = now().toISOString()`
   - provider, model, `schema_attempts`
   - nullable tokens and cost
   - canonical `missing`, sources, diff_stats, input and grounding
   Then `PrBriefStored.safeParse`. A failure returns 502 with no write and log `brief=1 invalid_output` (AC-68). On success, `upsertBrief` (AC-27; last successful write wins, no CAS).
8. Re-read `pull_requests.head_sha` and set `stale = stored sha !== current` (AC-77, AC-29). `logBriefGeneration` writes exactly one line on every path, including steps 3 and 5 (AC-26). Return `{...brief, pr_id, stale}`.

**GET `/pulls/:id/brief`:** DB only. Load the PR: 404 (AC-49), or 403 with body `{error}` only, decided before `getBrief` is called (AC-56). Then `getBrief`, then `PrBrief.safeParse`.
- A failed parse logs `warn` and returns 404 (spec edge case).
- No row returns 404.
- Otherwise return `{...brief, pr_id, stale: meta.generated_from_head_sha !== pr.headSha}` (AC-28, AC-29).

### Contract (frozen in P1, both `brief.ts` copies byte-identical)

```ts
// Risk / Risks: UNCHANGED shared schema (D-4, AC-84). ">= 1 file_refs" lives in server-only PrBriefStored.

export const ReviewFocusItem = z.object({ file: z.string(), line: z.number().int().min(1),
  reason: z.string(), line_adjusted: z.boolean().optional() }); // set only by grounding (AC-69)
export const BriefMissingInput = z.enum(['intent','blast','description','linked_issue','specs','diff']);
export const BriefSection = z.enum(['specs','linked_issue','description','blast_callers','diff_stats']);
export const BriefDiffStats = z.object({ files: z.number().int(), additions: z.number().int(),
  deletions: z.number().int(), by_role: z.object({ core: z.number().int(), tests: z.number().int(),
  wiring: z.number().int(), docs: z.number().int(), boilerplate: z.number().int() }) });
export const BriefMeta = z.object({
  generated_from_head_sha: z.string(),
  generated_at: z.string().datetime(), // ISO-8601 UTC, 'Z' only, no offset (AC-71)
  provider: z.string(), model: z.string(), schema_attempts: z.number().int().min(1),
  tokens_in: z.number().int().nullable(), tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(), // AC-70
  missing: z.array(BriefMissingInput).refine(
    (a) => a.every((v, i) => i === 0 || BriefMissingInput.options.indexOf(a[i - 1]) < BriefMissingInput.options.indexOf(v)),
    'missing must be unique and in canonical order', // AC-45: enum order IS the canonical order
  ),
  sources: z.array(IntentSource),
  diff_stats: BriefDiffStats.nullable(),
  input: z.object({ estimated_tokens: z.number().int(), budget_tokens: z.number().int(),
    truncated: z.array(BriefSection), blast_degraded_reason: z.string().nullable() }),
  grounding: z.object({ dropped_risks: z.number().int(), dropped_refs: z.number().int(),
    dropped_focus: z.number().int(), adjusted_lines: z.number().int() }),
});
export const PrBrief = z.object({
  summary: z.string(), intent: Intent.nullable(), blast: BlastRadius.nullable(),
  risks: Risks, review_focus: z.array(ReviewFocusItem), history: PrHistory.optional(),
  meta: BriefMeta,
});
```

- Server route response: `BriefResponseSchema = PrBrief.extend({ pr_id: z.string(), stale: z.boolean() })` in `brief/routes.ts`. 429 and 502 return `{error: string, retry_after: number}`; 403 and 404 return `{error}` only. The server-only `PrBriefStored` (in `brief/schema.ts`) is used before every write. It is not part of the shared contract.
- Client mirror (`client/src/lib/hooks/brief.ts`, type only, same pattern as `hooks/blast.ts`): `export type BriefResponse = PrBrief & { pr_id: string; stale: boolean }`.

### Input budget (from the spec; measured on the exact serialized payload)

- `estimateTokens = ceil((JSON.stringify(messages).length + JSON.stringify(toJsonSchema(BriefModelOutput, 'PrBriefOutput')).length) / 4)`. The output schema travels in `response_format`, and the spec counts it. This value is `meta.input.estimated_tokens` and the log's `est_input_tokens`.
- Total 8,000 = framing reserve 1,500 + 6,500 for variable sections. Ceilings are measured on escaped content (T38). Sections never borrow.

| Section | Ceiling | Handling |
|---|---|---|
| Framing: instructions, output schema, guard, block tags and labels, markers, missing list, PR title | 1,500 (reserved) | Never cut. Test: worst case (256-char title made of `<`, all 6 missing, every marker) <= 1,500. |
| Intent summary | 300 | Never cut. Capped at ingest to 300 tokens of escaped text. This is a cap, not a truncation step, and is not recorded in `truncated`. |
| Intent in/out scope | 400 | 8 items per list, each <= 90 chars before escaping. |
| Blast summary line | 100 | Deterministic (`buildSummary`), never cut. |
| Spec/plan doc | 800 | 1st: head plus marker; dropped (label and status only) when nothing else fits. |
| Linked issue | 700 | 2nd: title kept, body head plus marker. |
| PR description | 1,200 | 3rd: head plus marker. |
| Blast callers (<= 25, rank order from `buildBlastRadius`) | 500 | 4th: drop from the tail plus a marker line. |
| Diff stats rows | 2,500 | 5th: drop by role (docs -> boilerplate -> tests -> wiring -> core), then by lowest churn, plus a `+N more files (+A/-D)` line. Row = path (<= 200 chars), role, +a/-d, <= 6 ranges plus `+k more`. No status. |

After assembly the builder re-measures `estimateTokens`. Above 8,000, it cuts again in the same order, down to each section's minimum: docs dropped, issue title only, description marker only, no callers, aggregate diff line only. If it still does not fit, it returns `{ok: false, reason: 'input_over_budget'}` and does not throw (AC-64). Budget and ceilings come in through `opts`, so the over-budget path is testable.

### Grounding rules (`grounding.ts`)

- **Path matching:** reject when `!isSafeRepoPath` (AC-63). Otherwise apply `normalizeRef` (trim a leading `./`) and match exactly against the allow-list (case-sensitive). Store the allow-list key, not the model string (AC-62). Old rename paths are not keys, so they drop (AC-61). Model-supplied `line_adjusted` is ignored because the schema strips it (AC-69).
- **Risks** (AC-13, AC-14): keep refs that are in diff paths or `blastFiles` (all caller files in the blast map). Drop a risk when no refs remain.
- **Focus** (AC-15): the file must be in diff paths.
- **Line snapping** (AC-16):
  - A line inside any `[s, e]` range is kept.
  - Otherwise snap to the hunk start (among hunks with `newLines > 0`) with the smallest `|line - start|`; on a tie, the earlier hunk wins. Set `line_adjusted: true`.
  - Every diff fact has at least one range, because diffFacts drops files without new-side lines (AC-60). No fallback is needed.
  - `line_adjusted: true` is set only when the line moved; otherwise the key is omitted.
  - After snapping, remove duplicates by `file:line` (first wins).
- **Counts** (AC-17): `dropped_risks`, `dropped_refs`, `dropped_focus` and `adjusted_lines` go to `meta.grounding` and to the log line. Unsafe and non-canonical paths count as dropped refs or dropped focus items.

### Client

- **Hooks:** `client/src/lib/hooks/brief.ts` (new), exported from `hooks/index.ts`.
  - `usePrBrief(prId)` uses the key `["pr-brief", prId]` and does not retry on 404.
  - `useGenerateBrief(prId)` POSTs. On success it calls `setQueryData`. On a 429 it invalidates `["pr-brief", prId]` (AC-32).
- **Component dir `_components/PrBriefCard/`** (new; same layout as `BlastRadiusBlock/`):
  - `PrBriefCard.tsx`, `RiskList.tsx`, `ReviewFocusList.tsx`, `BriefStats.tsx`, `BriefSkeleton.tsx`
  - `constants.ts` (risk-kind -> icon map with a generic fallback, severity labels)
  - `helpers.ts` (missing-input labels, `isInDiff`, focus label, inputs-changed check)
  - `styles.ts`, `index.ts`, `PrBriefCard.test.tsx`, `helpers.test.ts`
- **`OverviewTab`** order: VerdictBanner (P3, latest `kind === 'review'` run), then the PrBriefCard (IntentBlock and BlastRadiusBlock rendered inside it, in every state), then Description.
- **URL navigation:** `client/src/app/repos/[repoId]/pulls/[number]/navigation.ts` (new). Exports `buildPrHref` (pure) and `usePrNavigation()`, returning `{tab, target, setTab, setParam, openInDiff}`. `setTab` clears `file` and `line`. `openInDiff(file, line)` replaces the URL with `?tab=diff&file=<enc>&line=<n>`. `page.tsx` uses it.
- **Diff navigation:** `DiffTab({target})` -> `DiffViewer({target})` -> `FileCard({forceOpen, highlightLine})` -> `CodeLine({highlighted, rowRef})`.
  - `FileCard` gets `data-testid="file-card"`, `data-path` and `data-highlighted`.
  - `SmartDiffGroup` opens initially when it contains the target file.
  - DiffTab shows the `notInDiff` toast each time the URL `file` changes to a different unknown path. A ref holds the last toasted path, and a re-render with the same path shows nothing (AC-83). Deep-link scrolling goes through `scrollToTarget` (T41): no focus move, and `behavior: 'auto'` under reduced motion (AC-74, AC-75).

## 3. Phases and tasks

Server tests live in `server/test/` (same as `blast-*`). Client tests sit next to the component. In every phase the failing tests named on each task are written before the code.

### P1: Contract (`brief.ts` x2)

- [x] T1 Write failing tests in `server/test/contracts.test.ts`, new `describe('PrBrief v2')`:
  - a full fixture parses
  - `intent: null`, `blast: null` with `history` omitted parses
  - missing `summary`, `review_focus` or `meta` is rejected
  - shared `Risk` parses `file_refs: []` (AC-84)
  - any `kind` string is accepted by the shared `Risk` (AC-79)
  - `tokens_in`, `tokens_out` and `cost_usd` accept `null` (AC-70)
  - `generated_at` rejects `2026-01-01T00:00:00+02:00` and `2026-01-01`, and accepts `...Z` (AC-71)
  - `missing: ['blast','intent']` and duplicates are rejected; canonical order is accepted (AC-45)
  - `meta.schema_attempts` is required
  - an unknown `meta.missing` value is rejected
  -> AC-24, AC-45, AC-70, AC-71, AC-79, AC-84 -> `contracts.test.ts > PrBrief v2 *`
- [x] T2 Edit `server/src/vendor/shared/contracts/brief.ts` to the frozen shape in section 2. Keep other exports unchanged. -> AC-24 -> `contracts.test.ts > PrBrief v2 *`
- [x] T3 Copy it byte-identically to `client/src/vendor/shared/contracts/brief.ts`. If the `index.ts` doc comments are touched, keep both `index.ts` copies identical too. -> AC-24 -> `contracts-parity.test.ts > brief.ts is byte-identical on server and client`
- [x] T4 Grep for `Risk`, `Risks` and `PrBrief` consumers (`server/src`, `client/src`, `reviewer-core/src`) and fix any compile breaks. Expected: none. -> AC-24 -> typecheck

Done when:
- `server`: `pnpm typecheck` and `pnpm exec vitest run test/contracts.test.ts test/contracts-parity.test.ts` pass.
- `client`: `pnpm typecheck` passes.
- `reviewer-core`: `pnpm typecheck` passes.

### P2: Server pure functions (`server/src/modules/brief/`, all files new)

- [x] T5 `constants.ts` and `schema.ts`. Tests:
  - `BriefModelOutput` rejects a missing `review_focus` and an unknown `kind`
  - `toJsonSchema(BriefModelOutput, 'PrBriefOutput')` has no `maxLength`, `minLength`, `maxItems` or `minItems`, and lists every property as required
  - the emitted schema has `additionalProperties: false` on every object and no `line_adjusted` property (AC-69)
  - a `kind` outside the 7 `RISK_KINDS` is rejected (AC-79)
  -> AC-23, AC-69, AC-79 -> `server/test/brief-schema.test.ts > model output schema is strict-mode safe`
- [x] T6 `diff-facts.ts`. Tests:
  - ranges come from `newStart`/`newLines`
  - no `status` key on any fact (AC-20)
  - a file whose hunks all have `newLines = 0` (deleted, `pr_files` fallback) is excluded (AC-60)
  - a binary or pure-rename entry (no `+++`) is absent (AC-60)
  - a rename with hunks is keyed by its new path only (AC-61)
  - unsafe paths are excluded (AC-63)
  - roles come from `classifyFile`
  - a leading `./` is normalized
  - a sentinel placed in `raw` (body line and hunk-header context) is absent from `JSON.stringify(diffFacts(d))`
  - `diffStats` totals and `by_role`
  -> AC-16, AC-20, AC-55, AC-60, AC-61, AC-63 -> `server/test/brief-diff-facts.test.ts`
- [x] T7 `prompt.ts`. Tests first:
  - the sentinel never appears in the messages
  - worst-case fixtures (2,000 files with 200-char paths, a 100 KB description of `<>&"`, a 64 KB spec, 200 callers, a 256-char title, every marker) give `estimateTokens` <= 8,000, computed on the exact `JSON.stringify(messages)` plus the schema (AC-19)
  - one test per truncation step (only that section oversize -> `truncated` equals that section; all oversize -> the spec order)
  - protected sections stay byte-identical (instructions, title, intent summary, blast summary, missing list)
  - a marker appears in each cut section
  - `missing` detected in shuffled order comes out as `intent, blast, description, linked_issue, specs, diff`, both in the metadata and in the prompt text (AC-45)
  - every untrusted section is wrapped by `wrapBlock` (T38), and the guard text is present
  - framing alone is <= 1,500 estimated tokens
  - with an inflated framing (via `opts`), the post-assembly re-measure cuts more in the same order until the input fits
  - no hunk-header context text (sentinel after `@@ … @@`) and no `status` field appear (AC-20)
  -> AC-19, AC-20, AC-21, AC-22, AC-45 -> `server/test/brief-prompt.test.ts`
- [x] T8 `grounding.ts`. Tests first:
  - one valid and one invented risk ref -> only the valid one survives
  - a risk whose refs are all invalid is dropped
  - a blast-only focus item and an invented focus item are both dropped
  - snapping with `[10-20, 50-60]`: line 35 -> 50, adjusted; line 30 -> 10 (tie); line 15 kept, not adjusted
  - case mismatch is dropped
  - `./src/a.ts` matches and is STORED as `src/a.ts` (AC-62)
  - `/etc/x`, `C:\x`, `a/../b` and `a\0b` are dropped and counted (AC-63)
  - a deleted-file ref and a binary-file ref (not in facts) are dropped and counted (AC-60)
  - an old rename path is dropped and the new path kept (AC-61)
  - a model `line_adjusted: true` on an in-range line is not stored (AC-69)
  - counts are correct
  - clamping enforces summary 600, 8 risks, explanation 400, 7 focus items, reason 200
  - a risk in the output always has `file_refs.length >= 1`
  -> AC-8, AC-13, AC-14, AC-15, AC-16, AC-17, AC-60, AC-61, AC-62, AC-63, AC-69 -> `server/test/brief-grounding.test.ts`
- [x] T9 `log-line.ts`. Tests:
  - `briefCallsLabel` for all 6 outcomes: `brief=1 ok|invalid_output|provider_error|timeout` and `brief=0 provider_unavailable|input_over_budget` (D-7: one call, never "N calls")
  - `briefLogFields` contains:
    - pr_id, the `calls` label and `schema_attempts` (null when `brief=0`)
    - provider/model (null when unresolved), est_input_tokens (null when not computed)
    - tokens_in/out (nullable), cost_usd (nullable), truncated
    - grounding counts (absent when grounding did not run), missing
    - outcome, error_class, error_message
  - no prompt, document or body text is included
  -> AC-17, AC-18, AC-26 -> `server/test/brief-log-line.test.ts`

- [x] T36 `paths.ts`: `isSafeRepoPath` and `normalizeRef`. Cases: NUL, `/a`, ``, `C:`, `c:/a`, `a/../b`, `..`, `./a` (safe after normalize), `a..b` (safe). Used by diff-facts (T6), the blast caller list in the prompt (T7) and grounding (T8). -> AC-63 -> `server/test/brief-paths.test.ts`
- [x] T37 `PrBriefStored` in `schema.ts`. Tests: rejects a risk with `file_refs: []`; accepts a full grounded fixture; the shared `Risk` still accepts `[]`. -> AC-68, AC-84, AC-8 -> `server/test/brief-schema.test.ts > stored schema`
- [x] T38 `wrapBlock(label: BlockLabel, text)` in `prompt.ts`. Labels come from a fixed union (`pr_title`, `pr_description`, `linked_issue`, `spec_doc`, `intent`, `blast`, `diff_stats`). The content is entity-escaped (`&` -> `&amp;`, `<` -> `&lt;`, `>` -> `&gt;`), so no literal `<untrusted`, `</untrusted>` or tag can appear inside it. Tests:
  - the escaped form of `</untrusted>` and `<untrusted source="system">` in every untrusted field (AC-65)
  - an adversarial fixture with fake closing and opening tags plus "ignore previous instructions" in the description, issue, spec and a file path -> parsing the user message with `/<untrusted source="([a-z_]+)">/g` gives exactly the expected label list in order, and each injected sentinel sits between its own block's open and close (AC-66)
  -> AC-65, AC-66 -> `server/test/brief-prompt.test.ts > adversarial delimiters`
- [x] T39 Over-budget path in `buildBriefPrompt`: with `opts.budgetTokens` below framing plus protected content, it returns `{ok: false, reason: 'input_over_budget'}`, does not throw, and every truncatable section has been cut to its minimum before giving up. -> AC-64 -> `server/test/brief-prompt.test.ts > protected content over budget`
- [x] T40 `classifyLlmError(err)` in `log-line.ts` returns `{outcome, error_class, error_message}`:
  - `TimeoutError` -> `timeout`
  - a message matching `/structured output failed schema validation/` -> `invalid_output`
  - `ConfigError` -> `provider_unavailable`
  - anything else -> `provider_error`
  `error_class` is taken from an allow-list of names (else `'Error'`). `error_message` is a fixed per-outcome string, plus the HTTP status when numeric; `err.message` and `err.details` are never copied. Test: an error with a prompt sentinel and `sk-test-123` in both message and details -> neither appears in the result. -> AC-67, AC-82, AC-81 -> `server/test/brief-log-line.test.ts > classifyLlmError`

Done when: `server`: `pnpm typecheck` and `pnpm exec vitest run test/brief-` pass.

### P3: Server service, repository, routes, registration (depends on P1 and P2)

- [x] T10 Refactor `server/src/modules/blast/files.ts`: add `changedDiffForPr(container, ws, pr, log): Promise<DiffLoadResult>`, where `DiffLoadResult = {status: 'loaded', diff} | {status: 'unavailable', reason}`. It is shared in flight and imports the PR detail once. Classification:
  - (1) first `loadDiff` has >= 1 file -> `loaded`
  - (2) otherwise `getPullDetail`, then `loadDiff` again: >= 1 file -> `loaded`
  - (3) still 0 files and the PR has >= 1 `pr_files` row (every file deleted, pure-rename, binary or patch-less) -> `loaded` with 0 files (AC-59)
  - (4) 0 `pr_files` rows, no repo row, or any throw -> `unavailable` (AC-48)
  `changedFilesForPr` maps `loaded` to paths and `unavailable` to `[]` (blast behaviour unchanged). Existing tests stay green, plus new tests covering each of (1)-(4).
  -> AC-48, AC-59 -> `server/test/blast-files.test.ts > changedDiffForPr *`
- [x] T11 `repository.ts` (`BriefRepository`). -> AC-27 -> covered by T15
- [x] T12 `service.ts`. Tests first in `server/test/brief-service.test.ts`, using stub repos, a `MockLLMProvider` spy, a repoIntel stub and a `MockGitHubClient`:
  - exactly one `completeStructured` call, `maxRetries: 1`, model from the arguments. `meta.schema_attempts` comes from the result `attempts` (AC-18)
  - invented paths are dropped (end to end through the service)
  - no `pr_intent` -> `missing` includes `intent`, and the intent repo's write and derive are never called
  - degraded `getBlastRadius` with 0 symbols -> `missing` includes `blast` and `blast_degraded_reason` is set
  - a throwing `github.getIssue` or `readRepoFile` -> generation continues and the source status is `error`
  - diff `unavailable` -> `missing` includes `diff`, `review_focus` is `[]`, and risk refs ground only against blast files (AC-48)
  - diff `loaded` with 0 files -> `diff_stats.files = 0`, `diff` not in `missing`, `review_focus: []` (AC-59)
  - a stub with usage 0/0 and `costUsd: null` -> `tokens_in`, `tokens_out` and `cost_usd` are null and `PrBriefStored` parses (AC-70)
  - fixed `now()` -> `generated_at === '2026-10-09T12:00:00.000Z'` (AC-71)
  - a forced invalid post-grounding object (an injected `ground` that returns a risk with `file_refs: []`) -> 502-class failure, `outcome: 'invalid_output'`, no upsert (AC-68)
  - `buildBriefPrompt` returns `{ok: false}` -> `outcome: 'input_over_budget'`, zero LLM calls, no upsert (AC-64)
  - the spy shows `IntentService` is never imported or constructed: `vi.mock('../src/modules/intent/service.js')` with a throwing constructor (AC-43)
  - `completeStructured` rejects -> `status: 'failed'` and `upsertBrief` is not called
  - a stub that never resolves plus fake timers advanced by 50 s -> `outcome: 'timeout'` and no upsert; at 49.9 s it is still pending (AC-82)
  - the stored JSON has `sources` with labels and statuses only; a sentinel from the spec content is absent
  -> AC-13, AC-14, AC-15, AC-17, AC-18, AC-23, AC-25, AC-27, AC-33, AC-43, AC-44, AC-46, AC-47, AC-48, AC-55, AC-59, AC-60, AC-64, AC-68, AC-70, AC-71, AC-82
- [x] T13 `routes.ts`. Tests first in `server/test/brief-routes.test.ts` (fakeDb, same approach as `intent-routes.test.ts`, with `vi.mock('../src/modules/brief/log-line.js')` spying on `logBriefGeneration`; fake clock via `vi.setSystemTime`):
  - GET: 404 when there is no PR or no row (AC-49)
  - GET: 403 for a PR in another workspace with a seeded brief; the body has no brief fields (AC-56)
  - GET: 404 plus a warning when the stored JSON fails to parse
  - GET: 200 with zero LLM calls (AC-28)
  - GET: `stale: true` after `head_sha` changes (AC-29)
  - POST: no PR -> 404 with zero GitHub, `upsertBrief` and LLM calls (AC-57)
  - POST: another workspace -> 403 with zero GitHub, DB-write and LLM calls; an immediate POST by a member is admitted, not 429 (AC-58)
  - POST: a second request within 30 s -> 429 with `Retry-After` and a `{error, retry_after}` body, no extra calls (AC-31)
  - POST: 29.2 s left -> `retry_after: 30` and `Retry-After: 30`; 0.1 s left -> 1 (AC-72)
  - POST: the first POST fails with provider_unavailable, the second POST -> 429 (AC-31)
  - POST: a workspace `feature_models.risk_brief` override -> the llm is called with that model, and `meta.provider`/`meta.model` record it (AC-25)
  - POST: no key for the configured provider, with another provider injected -> 502 whose message names the Risk Brief model setting, zero calls on every LLM, row unchanged, log `brief=0 provider_unavailable` (AC-81)
  - POST: LLM throws -> 502 `{error, retry_after}`, log `brief=1 provider_error` (AC-33)
  - POST: the adapter throws a schema-validation `ExternalServiceError` -> 502, row unchanged, log `brief=1 invalid_output` (AC-23)
  - POST: the error message holds a prompt sentinel and `sk-test-123` -> neither appears in the log fields or the 502 body (AC-67)
  - POST: protected content over the budget (huge Intent summary plus a reduced budget through `opts`) -> 502, zero LLM calls, row unchanged, log `brief=0 input_over_budget` (AC-64)
  - POST: timeout -> 502 and log `timeout` (AC-82)
  - POST: success -> exactly one log call with `brief=1 ok`, `schema_attempts: 1` and the grounding counts; the response `meta.grounding` matches (AC-17, AC-18, AC-26)
  - POST: the LLM stub updates `head_sha` -> response `stale: true`, and the stored SHA is the pre-generation one (AC-77)
  - POST: degraded blast, no intent, unavailable diff -> 200 with canonical `missing` (AC-43, AC-44, AC-48)
  - POST: loaded diff with 0 files -> `diff` not in missing, `review_focus: []` (AC-59)
  - POST twice (after advancing time) -> a new LLM call and the brief replaced (AC-30)
  -> AC-17, AC-18, AC-23, AC-25, AC-26, AC-28, AC-29, AC-30, AC-31, AC-33, AC-43, AC-44, AC-48, AC-49, AC-56, AC-57, AC-58, AC-59, AC-64, AC-67, AC-72, AC-77, AC-81, AC-82
- [x] T14 Register `brief` in `server/src/modules/index.ts`. -> AC-49 -> `brief-routes.test.ts` (routes reachable)
- [x] T15 `server/test/brief.it.test.ts` (new, testcontainers):
  - POST stores one `pr_brief` row whose JSON has `meta.generated_from_head_sha` (AC-27)
  - seed a brief, make the stub throw -> 502 and the row is unchanged (AC-33)
  - the stored row contains no sentinel from the issue body or the spec doc (AC-46)
  - no `pr_intent` row plus a degraded index -> `meta.missing` includes `['intent','blast']` (AC-7)
  -> AC-7, AC-27, AC-33, AC-46

Done when:
- `server`: `pnpm typecheck` and `pnpm test` pass (unit and integration; integration needs Docker, otherwise run `pnpm exec vitest run --exclude '**/*.it.test.ts'` and note the skipped file).
- Manual check: GET reads only the DB (code review: no `loadDiff`, github or llm call on the GET path).

### P4: Client hooks, i18n, card core states (depends on P1)

- [x] T16 `client/src/lib/hooks/brief.ts` (new) and the export in `client/src/lib/hooks/index.ts`. Tests: 404 is not retried; a 429 error invalidates `["pr-brief", prId]`; success sets the query data. -> AC-1, AC-2, AC-28, AC-32 -> `client/src/lib/hooks/brief.test.tsx`
- [x] T17 `client/messages/en/brief.json`.
  - Reuse `block.intent`, `block.blast`, `block.risks`, `noRisks`, `unavailable` and `unavailableHint`. Update the `unavailableHint` text to describe generating a brief; it has no current consumers.
  - Add:
    - `card.title`, `card.generate`, `card.regenerate`, `card.regenerating`, `card.summary`, `card.reviewFocus`, `card.noFocus`
    - `card.stale`, `card.generatedAt`, `card.missing` ("Generated without: {list}"), `card.rateLimited` ("Generation was started recently. Try again in {seconds, plural, ...}"; never says a brief is ready, AC-32), `card.generateError`, `card.retry`, `card.loadError`, `card.expandRisk` ("Show details: {title}"), `card.openRef` ("Open {file}")
    - `card.notInDiff` ("File not in this PR's diff"), `card.lineAdjusted`, `card.inputsChanged` ("Inputs changed since this brief — Regenerate"), `riskKind.unknown` (fallback aria label)
    - `missingInput.{intent,blast,description,linked_issue,specs,diff}`, `severity.{high,medium,low}`, `riskKind.{security,db_migration,breaking_api,perf,deps,correctness,other}`
    - `stats.files`, `stats.sources`, `stats.role.{core,tests,wiring,docs,boilerplate}`
  -> AC-54 -> `PrBriefCard.test.tsx` (renders with the real `brief.json`)
- [x] T18 `_components/PrBriefCard/` core: `PrBriefCard.tsx`, `RiskList.tsx`, `ReviewFocusList.tsx`, `index.ts`, `styles.ts`, `constants.ts`. Tests first in `PrBriefCard.test.tsx` (mock `@/lib/hooks/brief` and `@/lib/toast`):
  - GET 404 -> empty state and a "Generate brief" button (AC-1)
  - click -> one POST (AC-2)
  - pending -> button disabled and `aria-busy` on the wrapper (AC-3)
  - resolved -> summary, risks and focus render (AC-4)
  - risk shows its title and first file (AC-8)
  - focus renders `file:line - reason` in the given order (AC-9)
  - Regenerate in the header -> POST (AC-10, AC-30)
  - `risks: []` -> `noRisks` (AC-11)
  - `review_focus: []` -> `card.noFocus` (AC-12)
  - `stale` -> badge with `role="status"` (AC-29)
  - 429 -> the brief (or the empty state) stays, `card.rateLimited` shows the seconds (`role="status"`), exactly one GET refetch happens, and a refetch that returns 404 keeps the empty state with no "ready" wording (AC-32)
  - 502 -> alert with Retry, previous brief still shown (AC-34)
  - model text is rendered as text, never as HTML
  -> AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-10, AC-11, AC-12, AC-29, AC-30, AC-32, AC-34, AC-54
- [x] T19 `helpers.ts` with `helpers.test.ts`:
  - `missingLabels`, `isInDiff(path, diffPaths)`, `focusLabel`
  - `riskKindIcon` (unknown kind -> generic icon, AC-80)
  - `inputsChanged(brief, liveIntent, liveBlast)` compares Intent presence, summary and in/out scope items, and Blast presence, summary and the caller-file SET. Order is ignored. Tests: a null snapshot with live Intent -> true; the same callers reordered -> false (AC-78)
  -> AC-7, AC-41, AC-78, AC-80 -> `PrBriefCard/helpers.test.ts`

Done when: `client`: `pnpm typecheck` and `pnpm test` pass; a grep for English string literals in `PrBriefCard/*.tsx` finds none (AC-54).

- [x] T42 Interface handoff checkpoint (orchestrator, no code). Freeze and record in the PR description the interfaces listed in section 9. The P5 and P6 agents get them as input. -> AC-35, AC-41, AC-54 (interfaces those ACs depend on) -> `client pnpm typecheck` after P4

### P5: Card details and wishes (depends on P4)

- [x] T20 Missing-data note: `missing.length > 0` -> `card.missing` listing the localized inputs, `role="status"`. -> AC-7 -> `PrBriefCard.test.tsx > missing note names intent and blast`
- [x] T21 `BriefStats.tsx`: file count, +additions/-deletions, files per role, and source chips with statuses (reuses `getSourceIcon`/`getSourceColor` from `../IntentBlock/helpers`). `diff_stats.files === 0` renders an empty stats row; `diff_stats: null` hides it. -> AC-55, AC-59 -> `PrBriefCard.test.tsx > stats and sources`
- [x] T22 `BriefSkeleton.tsx`, regenerate behaviour and risk expand:
  - first generation in flight -> two-column skeleton (AC-52)
  - regeneration in flight -> previous brief dimmed with "Regenerating..." (AC-53)
  - the risk chevron is its own `<button>` with `aria-expanded` (flips on toggle), `aria-controls` = the id of the explanation region, and an accessible name containing the risk title (`card.expandRisk`). It toggles the explanation and all refs (AC-51)
  - `kind: 'custom'` renders the generic icon plus the text label (AC-80)
  - severity shown as text or icon, never colour alone
  -> AC-51, AC-52, AC-53, AC-80 -> `PrBriefCard.test.tsx > skeleton / regenerating / expand`
- [x] T23 Navigation callbacks. The card takes `diffPaths: Set<string>` and `onOpenInDiff(file, line | null)`.
  - focus items are `<button>`s whose accessible name includes `file:line`
  - a click on a focus item whose file is in the diff calls `onOpenInDiff`
  - each risk file ref is its own navigate `<button>` (`card.openRef`), separate from the chevron. Click, Enter and Space on navigate never toggle expansion, and the same on the chevron never navigates (AC-73). Navigate follows the same rules (AC-42)
  - a path not in the diff -> `notify.info(t('card.notInDiff'))` and no navigation
  -> AC-35, AC-41, AC-42, AC-73 -> `PrBriefCard.test.tsx > navigation`

Done when: `client`: `pnpm typecheck` and `pnpm test` pass.

### P6: Files changed navigation and URL state (depends on P4 for `card.notInDiff`; can run alongside P5)

- [x] T24 `client/src/app/repos/[repoId]/pulls/[number]/navigation.ts` (new): `buildPrHref`, `usePrNavigation`. Tests in `navigation.test.tsx` with `vi.mock('next/navigation')`:
  - `openInDiff('src/a b.ts', 12)` -> `router.replace` with `?tab=diff&file=src%2Fa%20b.ts&line=12` (AC-36)
  - `setTab('overview')` removes `file` and `line` (AC-40)
  - `target` is parsed from search params. An invalid `line` gives `null`; an unsafe `file` (NUL, absolute, `..`) gives `target: null` (AC-63)
  - `openInDiff` calls `router.replace` and never `push` (AC-76)
  -> AC-36, AC-40, AC-63, AC-76
- (T25 moved to P7: P7 owns `page.tsx`.)
- [x] T26 `client/src/components/diff-viewer/{DiffViewer,FileCard,CodeLine}`:
  - `DiffViewer({target})` passes `forceOpen` and `highlightLine` to the matching `FileCard`
  - `FileCard` adds `data-testid="file-card"`, `data-path`, opens when `forceOpen`, and in an effect calls `scrollIntoView` on the matching `newNo` row (highlighted, `data-highlighted`) or on the header
  - `CodeLine` accepts `highlighted` and `rowRef`
  - Tests in `FileCard.test.tsx` stub `Element.prototype.scrollIntoView`:
    - target line rendered -> row scrolled and highlighted (AC-38)
    - line not rendered -> header scrolled (AC-39)
    - a large file over `AUTO_EXPAND_MAX_LINES` is still forced open (AC-35)
    - scrolling goes through `scrollToTarget` (T41), and `document.activeElement` is unchanged (AC-74)
  -> AC-35, AC-38, AC-39, AC-74, AC-75
- [x] T27 `DiffTab.tsx`, `SmartDiffGroup.tsx`: accept `target`. In smart order, the group holding the target opens even if collapsed by default. A URL `file` that is not a PR file -> `notify.info(card.notInDiff)` once per distinct unknown path (a ref keeps the last toasted path). Tests in `DiffTab.test.tsx`:
  - target file expanded in flat mode (AC-37)
  - target in a docs group -> the group opens
  - unknown A -> one toast; a re-render with A -> no new toast; a change to unknown B -> a second toast (AC-83)
  -> AC-35, AC-37, AC-41, AC-83

- [x] T41 `client/src/components/diff-viewer/scroll.ts`: `scrollToTarget(el)` calls `el.scrollIntoView({block: 'center', behavior: reduced ? 'auto' : 'smooth'})`, where `reduced = matchMedia('(prefers-reduced-motion: reduce)').matches`. It never calls `focus()`. Tests: mocked reduce -> `'auto'`, otherwise `'smooth'`; `document.activeElement` is unchanged. Used by T26. -> AC-74, AC-75 -> `client/src/components/diff-viewer/scroll.test.ts`

Done when: `client`: `pnpm typecheck` and `pnpm test` pass (existing `DiffTab*`, `FileCard` and `SmartFindingCard` tests stay green).

### P7: Overview integration (depends on P5 and P6; sole owner of `page.tsx` and `OverviewTab.tsx`)

- [x] T25 `page.tsx`: use `usePrNavigation`; pass `target` to `DiffTab`. The trace param still works. -> AC-37, AC-40 -> `navigation.test.tsx`

- [x] T28 `OverviewTab.tsx`: new props `diffPaths`, `onOpenInDiff`, `latestReview`. Render VerdictBanner (only when a `kind === 'review'` run exists; findings count and CRITICAL blockers taken from that run), then `PrBriefCard` with `IntentBlock` and `BlastRadiusBlock` inside it in every state, then Description. Tests in `OverviewTab.test.tsx` (new; hooks mocked):
  - banner shown with a review, hidden without (AC-50)
  - an intent fixture renders the summary and scope inside the card (AC-5)
  - a blast fixture renders the summary line and callers inside the card (AC-6)
  - the old standalone blocks are not duplicated
  -> AC-5, AC-6, AC-50
- [x] T29 `page.tsx`: pass `diffPaths` (from `pr.files`), `onOpenInDiff = openInDiff` and the latest review to `OverviewTab`. Test in `OverviewTab.test.tsx`: clicking a focus item calls the navigation with (file, line); a blast-only risk ref shows the toast. -> AC-35, AC-41, AC-42
- [x] T30 Inputs-changed hint (D-2): when `inputsChanged` (T19) is true, show the advisory `card.inputsChanged` (`role="status"`) with Regenerate. It never blocks or hides the brief. Tests: a null snapshot with live Intent -> hint; reordered callers -> no hint. -> AC-78 -> `PrBriefCard.test.tsx > inputs changed hint`
- [x] T31 Accessibility pass: Generate and Regenerate have accessible names; the stale badge, missing note, 429 and 502 messages have `role="status"` or `role="alert"`; risk and focus items are keyboard-focusable buttons. -> AC-3, AC-7, AC-9 -> `PrBriefCard.test.tsx > a11y roles`

Done when: `client`: `pnpm typecheck` and `pnpm test` pass.

### P8: e2e and docs (depends on P3 and P7)

- [x] T32 `e2e/specs/08-pr-brief.flow.json` (new):
  - PR #482 -> Overview -> wait for the text "PR Brief" and "Generate brief" (AC-1; the seed has no brief, so no model call)
  - Then, if agent-browser's `eval` command is available: set `location.search='?tab=diff&file=src%2Fconfig.ts&line=<new-side line in the seeded patch>'` and wait for the `file-card` with `data-path="src/config.ts"` to be expanded and highlighted (AC-37, AC-38). If `eval` is not available, drop those steps and record that component tests cover them.
  - Run `05-pr-diff` and `02` again as regression (the Overview layout changed).
  -> AC-1, AC-37, AC-38
- [x] T33 `e2e/README.md` coverage table row and `e2e/specs/flows.md` entry. -> AC-1 -> docs
- [x] T34 `server/README.md`: add `brief` to the API map (`GET/POST /pulls/:id/brief`) and a short "PR Brief" note (one call, 8k budget, grounding, 30 s limiter, no hunk bodies). Add one line to the `client/README.md` route map. -> housekeeping (no AC) -> docs
- [x] T35 Final run:
  - server: `pnpm typecheck`, `pnpm test`
  - client: `pnpm typecheck`, `pnpm test`
  - reviewer-core: `pnpm typecheck`
  - `./scripts/e2e.sh`
  -> all

Done when every command in T35 is green, or a skip is explained (Docker or agent-browser unavailable).

## 4. Coverage table (AC -> tasks)

| AC | Tasks | AC | Tasks |
|---|---|---|---|
| AC-1 | T16, T18, T32 | AC-29 | T13, T18 |
| AC-2 | T16, T18 | AC-30 | T13, T18 |
| AC-3 | T18, T31 | AC-31 | T13 |
| AC-4 | T18 | AC-32 | T16, T18 |
| AC-5 | T19, T28, T30 | AC-33 | T12, T13, T15 |
| AC-6 | T19, T28, T30 | AC-34 | T18 |
| AC-7 | T15, T19, T20, T31 | AC-35 | T23, T26, T27, T29 |
| AC-8 | T1, T8, T18 | AC-36 | T24 |
| AC-9 | T18, T31 | AC-37 | T25, T27, T32 |
| AC-10 | T18 | AC-38 | T26, T32 |
| AC-11 | T18 | AC-39 | T26 |
| AC-12 | T18 | AC-40 | T24, T25 |
| AC-13 | T8, T12 | AC-41 | T19, T23, T27, T29 |
| AC-14 | T8, T12 | AC-42 | T23, T29 |
| AC-15 | T8, T12 | AC-43 | T12, T13 |
| AC-16 | T6, T8 | AC-44 | T12, T13 |
| AC-17 | T8, T9, T13 | AC-45 | T1, T7 |
| AC-18 | T9, T12, T13 | AC-46 | T12, T15 |
| AC-19 | T7 | AC-47 | T12 |
| AC-20 | T6, T7 | AC-48 | T10, T12, T13 |
| AC-21 | T7 | AC-49 | T13, T14 |
| AC-22 | T7 | AC-50 | T28 |
| AC-23 | T5, T12, T13 | AC-51 | T22 |
| AC-24 | T1, T2, T3, T4 | AC-52 | T22 |
| AC-25 | T12, T13 | AC-53 | T22 |
| AC-26 | T9, T13, T34 | AC-54 | T17, T18 |
| AC-27 | T11, T12, T15 | AC-55 | T6, T12, T21 |
| AC-28 | T13, T16 (e2e part deferred, see section 6) | | |

No AC is uncovered.

## 5. Trade-offs and rationale

- **Prompt builder in the server module, not in reviewer-core** (Intent's builder lives in `reviewer-core/src/intent/prompt-builder.ts`). The brief is a server-only feature that reads DB, repo-intel and GitHub inputs. reviewer-core is the review engine shared with the CI runner. Nothing is reused from it. `wrapUntrusted` escapes only the closing tag, which fails AC-65/66, so the brief has its own `wrapBlock`. `INJECTION_GUARD` is review-specific ("report findings..."), so the brief gets its own guard that follows the spec wording.
- **Reuse over new code:** `IntentRepository.getIntent`, `buildBlastRadius`, `classifyFile`, `RefResolver`, `resolveFeatureModel`, `withTimeout`, the Intent limiter pattern, and the blast diff import logic (refactored, not copied).
- **Length caps enforced in code, not in the JSON schema** (R2). Strict structured output may reject length keywords, and no existing schema in the repo uses them. The prompt states the caps; `clampOutput` enforces them. Validation (AC-23) still runs against the shape.
- **Limiter duplicated, not shared with Intent.** The Intent routes stay untouched, as the compatibility NFR requires; the duplicated logic is about 10 lines.
- **Navigation state in the URL, owned by the page through `usePrNavigation`.** DiffTab takes a plain `target` prop, so DiffTab tests need no router mock (AC-37 tests run on props).
- **Intent and Blast blocks always render inside the card** (OQ-2 default). This keeps their existing actions (Run Intent, Resync) when no brief exists, and avoids rendering them twice.

## 6. Risks, assumptions and items needing the user's acknowledgement

- **R1, deleted, pure-rename and binary files are excluded from the diff facts** (D-8, accepted). The `git diff` path drops them in the parser. On the `pr_files` fallback, deleted files survive the parser, and `diffFacts` drops them (no `newLines > 0` hunk). Grounding drops refs to them (AC-60). `parseUnifiedDiff` is unchanged.
- **R2, strict schema and length keywords.** Mitigated by T5's test that `toJsonSchema` contains no length keywords, plus code clamping. Still needs one manual smoke run against real OpenAI `gpt-4.1` before merge.
- **R3, timeout.** Worst-case adapter time is far over 60 s. The service caps the call at 50 s with `withTimeout` and passes `maxRetries: 1, timeoutMs: 45_000`. `withTimeout` does not abort the HTTP request, so a late response can still be billed; the log line records `outcome=timeout`.
- **R4, no change status** is derived or sent (spec non-goal, AC-20). Rename old paths are not kept, so refs using them are dropped (AC-61).
- **R5, `pr.files` (client, from the GitHub file list) can differ from the server's diff facts.** Deleted files appear in `pr.files` but never in the facts. A focus file can also leave `pr.files` after a new commit, or when the server used a stale `git diff`. A focus or risk file missing from `pr.files` shows the toast and does not navigate (AC-41). There is no guarantee that a server-grounded file is on the client.
- **R6, the Overview layout changes.** e2e flow 02 and the existing `IntentBlock` and `BlastRadiusBlock` tests are run again in T32 and T35. The components themselves are unchanged.
- **R7, contract change triggers reviewer-core CI.** reviewer-core typecheck runs in P1 and in T35.
- **R8, the fakeDb route tests do not evaluate `where`.** Workspace and settings scenarios are driven by row fixtures, as in `intent-routes.test.ts`. Real persistence is verified in T15.
- **R9, the in-memory limiter resets on restart** and is per process. The spec accepts this. It counts every admitted request, including pre-provider failures (AC-31). Auth runs before admission (AC-58). There is no CAS on writes: the last successful write wins, and the computed `stale` (AC-77) tells the user about freshness.
- **Assumptions:**
  - Intent with `confidence === 0` counts as present: its snapshot is stored and the card shows the live IntentBlock state.
  - Zero-file vs unavailable (T10): a PR with >= 1 `pr_files` row whose files are all excluded counts as `loaded`, 0 files (AC-59). A PR with 0 `pr_files` rows after the import counts as `unavailable`, because `getPullDetail` hides GitHub failures. A truly empty PR (rare) is therefore reported with `diff` missing. Accepted residual.
- **AC-28 e2e is deferred.** It needs a stored brief, and the demo seed deliberately starts with no generated content while e2e is LLM-free. The route test (zero LLM calls on GET) and the component test cover the behaviour.

## 7. Out of scope

- PR history accordion and populating `PrBrief.history`.
- Deriving Intent during brief generation.
- Changes to the diff parser.
- A shared rate limiter across instances.
- Seeding a demo brief.
- A Project Context module.
- Streaming, version history, editing, or posting the brief to GitHub.
- Automatic regeneration on new commits.
- CI workflow changes. Existing path filters already cover `server/`, `client/`, `reviewer-core` and the vendored contract.
- Any DB schema or migration change.

## 8. Validation

- **Unit tests (server):** schema, diff-facts, prompt (budget, order, markers, sentinel, missing), grounding (paths, snapping, counts, clamp), log line, service (one call, degradation, no write on failure), routes (404/403/429/502, stale, model override, log).
- **Integration test (`brief.it.test.ts`):** persistence, the old row unchanged on failure, no document content persisted, `missing` on a degraded PR.
- **Client tests:** hooks, every card state, helpers, navigation hook, FileCard/DiffTab target behaviour, OverviewTab composition.
- **e2e:** empty state on the seeded PR, plus URL deep-link highlight when supported.
- **Manual:** one real generation with the default `openai/gpt-4.1`. Check that the log line shows `brief=1 ok`, an estimate <= 8000, and a `tokens_in` comparison. Check that GET latency is DB-only.
- **Breaking changes:** `PrBrief` shape. There are no stored rows and no runtime consumers, so the impact is none. The shared `Risk` is unchanged (AC-84). Stored rows from the old shape fail `PrBrief.safeParse` and GET returns 404 with a warning (spec edge case).

## 9. Execution mode: multi-agent (user decision)

**Recommendation: multi-agent, two tracks after P1.**

- **P1 runs alone** (contract freeze; the only dependency shared between server and client).
- **Track A (server):** P2 -> P3. Files only under `server/`.
- **Track B (client):** P4 -> T42 handoff checkpoint -> P5 and P6 in parallel (P6 as a third agent) -> P7.
  - **T42 checkpoint after P4.** P5 and P6 do not start until the orchestrator confirms these frozen interfaces:
    - `PrBriefCard` props `{prId, diffPaths, onOpenInDiff}`
    - the `PrBriefCard/index.ts` exports
    - the `helpers.ts` signatures
    - the `usePrNavigation` return type `{tab, target, setTab, setParam, openInDiff}`
    - `DiffTab({target})`
    - every `brief.json` key, including `card.notInDiff`, `card.expandRisk` and `card.openRef`
    A change after the checkpoint goes back through the orchestrator.
  - **File ownership rule.**
    - P5 edits only `_components/PrBriefCard/**`.
    - P6 edits only `navigation.ts` (+ test) and `client/src/components/diff-viewer/**`, plus `DiffTab.tsx` and `SmartDiffGroup.tsx`.
    - Neither P5 nor P6 edits `page.tsx`, `OverviewTab.tsx`, `OverviewTab` helpers or `brief.json`. P7 owns those (T25, T28, T29) and any `brief.json` additions.
- **Track A checkpoint:** P3 starts only after P2's exported signatures (`buildBriefPrompt` result union, `groundBrief`, `classifyLlmError`, `PrBriefStored`) are confirmed.
- **P8 runs last**, single agent.

Why: the server and client sets of files don't overlap. Client tests mock fetch, so they don't need a running server. The response type is frozen in section 2. Each phase fits one implementer run. Parallel tracks cut wall-clock time by roughly 40%.

Alternative: one sequential pass P1 -> P8. Simpler to review and no merge risk, but takes longer. Choose it if a single reviewer will read every phase in order anyway.
