# Cross-model review of SPEC-01 and plan

Reviewer model: openai/gpt-5.6-terra-pro via OpenRouter. Input: specs/01-pr-brief.md + docs/plans/pr-brief.md only.
Usage: {"prompt_tokens": 108356, "completion_tokens": 23369, "total_tokens": 131725, "cost": 0.4214608, "is_byok": false, "prompt_tokens_details": {"cached_tokens": 42044, "cache_write_tokens": 0, "audio_tokens": 0, "video_tokens": 0}, "cost_details": {"upstream_inference_cost": 0.4214608, "upstream_inference_prompt_cost": 0.1410328, "upstream_inference_completions_cost": 0.280428}, "completion_tokens_details": {"reasoning_tokens": 8303, "image_tokens": 0, "audio_tokens": 0}}

## Blocking issues

1. **“Exactly one model call” is not enforceable under the proposed retry design.**  
   - **Spec conflict:** AC-18/G3 says “exactly one structured model invocation,” while US-7/operator language says one generation made exactly one model call. The spec then permits “validation reprompts inside that invocation … as attempts,” which is provider terminology, not a billing guarantee.
   - **Plan conflict:** T12 passes `maxRetries: 1`; the research says an adapter can make up to 2 provider attempts, plus `withRetry` transport retries. T9’s `brief=N (retried, N attempts)` also treats attempts as calls, despite AC-18 requiring `completeStructured` to be called once.
   - **Why this matters:** the feature’s stated cost promise is false if a structured-output repair retry is a second provider request, and it can be billed twice.
   - **Concrete fix:** choose one contract and make it testable:
     - If “one billed provider request” is required, set `maxRetries: 0`, disable adapter transport retries for this call or count/report them separately, and have `call_count === 1`.
     - If retries are allowed, revise G3/AC-18/US-7 to say “one generation operation, up to N provider requests,” store/log `provider_request_count` separately from `schema_attempts`, and define the maximum cost.

2. **Diff semantics in the plan cannot satisfy several specified edge cases.**  
   - The plan’s research finds that `loadDiff` drops deleted, pure-rename, and binary files. Yet the spec explicitly requires:
     - deleted-file focus behavior (“first old-side hunk line”);
     - renamed-file grounding;
     - binary/large file navigation fallback;
     - zero changed files to produce an empty diff-stats section, not `missing: ['diff']`.
   - **Plan divergence:** R1 simply accepts that deleted/binary/pure-renamed files are absent. T10 returns `UnifiedDiff | null`, and R9 explicitly equates a valid zero-file PR with a failed diff load. That violates the zero-file edge case and AC-48’s distinction between “cannot be loaded” and “loaded, empty.”
   - **AC-16 is internally incomplete:** it defines snapping only over new-side ranges, while the edge-case table separately requires old-side behavior for deletions.
   - **Concrete fix:** introduce a result type such as:
     ```ts
     type DiffLoadResult =
       | { status: 'loaded'; files: DiffFact[] }  // files may be []
       | { status: 'unavailable'; reason: string };
     ```
     Extend deterministic diff facts/parser metadata to preserve deleted, renamed, and binary file entries where the product must navigate them. If this is deliberately out of scope, delete or explicitly revise the deleted/rename/binary promises and AC references before implementation; do not silently implement a different feature.

3. **Generation can overwrite a newer brief or store a brief stale at creation time.**  
   - AC-27 says replace the previous brief; AC-29 determines freshness from stored SHA versus current `head_sha`. The plan loads the PR/head SHA early, gathers data and calls the model, then unconditionally upserts and returns `stale: false`.
   - R3 acknowledges a non-aborting 50-second timeout. A late provider response can still be billed. More importantly, overlapping admitted generations across processes, a restart, or a head update during one request can result in:
     - generation A using old head SHA;
     - generation B using a newer SHA and storing a newer brief;
     - A completing later and overwriting B with the old brief.
   - The in-memory limiter only serializes per-process admissions; the spec explicitly accepts multi-instance non-shared limiting, so it does not solve this.
   - **Concrete fix:** use a conditional write/version strategy:
     - capture `generation_head_sha` and a generated request ID;
     - immediately before write, reread current PR head SHA;
     - either reject/discard output if it changed, or store it but compute `stale` from the current SHA rather than hard-code `false`;
     - use a compare-and-swap/upsert condition so an older generation cannot overwrite a row generated for a newer SHA.  
     Add integration tests for head movement during generation and out-of-order completion.

4. **The 8,000-token budget arithmetic is unsound as planned.**  
   - The section ceilings sum to exactly 8,000, but the required estimate applies to the **serialized system and user messages**. Serialization includes section tags, labels, JSON/schema text, delimiters, injection guard, wrappers, headings, truncation markers, range formatting, and newline/escaping overhead.
   - AC-21 says protected sections are never truncated. If protected content plus serialization exceeds its nominal reserve, the proposed final `throw` converts a required successful generation into an unhandled/undefined failure path.
   - T7’s “system message <= 4,000 chars” does not prove total serialized messages are <= 32,000 chars. “Per-section ceilings with no borrowing” also means unused capacity cannot compensate for overhead, despite the table having no overhead allocation.
   - **Concrete fix:** budget on the final exact serialized payload, with an explicit fixed overhead reserve. For example, reserve 1,500 estimated tokens for framing/schema/escaping and allocate at most 6,500 to variable sections. Apply deterministic shrinking until `ceil(serialized.length / 4) <= 8,000`; if immutable content alone exceeds the cap, return a defined pre-call error and log it as `input_over_budget`. Add boundary tests that include worst-case escaped text, long paths, markers, and all wrappers.

5. **The shared contract change has an unbounded compatibility blast radius and no versioning/migration strategy.**  
   - OQ-3 was still marked `[NEEDS CLARIFICATION]` in an “approved” spec. The plan says the defaults were “accepted,” but that acceptance is not present in the supplied spec.
   - Tightening shared `Risk.file_refs` to `.min(1)` changes a globally named contract, not merely a PR Brief DTO. T4’s assertion that there are “expected: none” consumers is not a sufficient compatibility analysis. Existing stored `pr_brief` rows are explicitly mentioned by the spec as potentially older/unparseable; the plan later asserts “There are no stored rows,” which contradicts that edge case.
   - GET treating old JSON as 404 is acceptable only if explicitly chosen, observable, and compatible with existing consumers. It is currently a silent data disappearance policy.
   - **Concrete fix:** either define a new `BriefRisk` contract and leave shared `Risk` unchanged, or introduce `PrBrief.version` plus a compatibility parser/migration path. Inventory all `Risk` parsers and persisted data before tightening it. Resolve OQ-3 formally and remove the stale “needs clarification” status only after that decision.

## Important issues

### AC quality, ambiguity, and contradictions

- **AC-49 is not atomic.** It combines GET and POST, nonexistent PR behavior, cross-workspace behavior, and an ordering/security requirement (“before any GitHub, DB-write or model work”). T13 only tests POST cross-workspace access; it does not cover GET for another workspace. Split it into separate GET/POST and 404/403 requirements.
- **AC-26 is not atomic.** It combines success and failure logging with eleven required fields. Define field behavior when no provider call occurs, provider resolution fails, timeout occurs, input assembly fails, or grounding never happens. T13 only clearly asserts a successful log.
- **AC-31 is too broad for one criterion.** It combines cooldown eligibility, exact timing, status code, header, body format, and “no GitHub or model.” It should specify `retry_after` rounding and whether it is the same value as `Retry-After`.
- **AC-46 combines live resolution, persistence minimization, and no-content storage.** These should be separate requirements. “Labels” is ambiguous: issue title/path label versus a stable URL/reference ID. “Only labels and statuses” should define allowed fields exactly.
- **AC-45 says `missing` is deterministic but does not define canonical order.** The enum order is not a requirement. This affects snapshots, tests, UI text, cache equality, and logs. Define the order explicitly, e.g. `intent, blast, description, linked_issue, specs, diff`.
- **AC-16 snapping can change semantic meaning.** A model may identify line 35 because of a relationship between hunks; snapping it to line 50 is not necessarily a valid substitute. The nearest-start rule is deterministic but misleading. The UI only exposes `line_adjusted`; it does not preserve the requested line or explain the adjustment.
- **AC-16 and the deleted-file edge case conflict.** New-side-only grounding/snap rules do not cover deleted files. The plan chooses behavior different from the spec.
- **AC-20’s “never diff hunk bodies” guarantee is weaker than claimed.** `diff-facts.ts` accepts `UnifiedDiff`, which includes `raw`; TypeScript does not make raw access “impossible at the type level.” The sentinel test detects an accidental direct serialization but not accidental use later. Also, a precomputed Intent summary may itself quote diff/code content; the spec does not say whether that counts as sending a diff body.
- **AC-41 is inconsistent with the chosen focus scope.** AC-15 disallows blast-only focus items, so AC-41 applies only to risks and stale/current-diff mismatch. That is valid, but it should state this rather than suggesting it is a normal focus case.
- **AC-5/AC-6 and OQ-2 leave live-versus-snapshot behavior underdefined.** The brief is generated from a snapshot, while the card renders live Intent/Blast blocks. “Inputs changed” compares only summaries in T30, which can miss changed scope lists/callers and can falsely differ due to formatting/order. Define canonical snapshot comparison or explicitly make the hint advisory.
- **The spec says stale after a new commit; it does not define stale after changed Intent/Blast/refs.** OQ-2 introduces a separate “inputs changed” state but not its precedence, copy, or cache semantics.
- **The 50-second plan timeout conflicts with the ≤60-second target without a full deadline.** Input gathering, GitHub resolution, blast computation, DB work, and response serialization consume time outside the 50-second LLM wrapper. There is no request-level deadline.

### Plan coverage gaps

- **AC-49 GET 403 is uncovered.** T13 tests GET 404 and POST 403, but not GET for a PR in another workspace.
- **AC-28’s “reload shows same brief immediately” is not actually covered end-to-end.** The plan explicitly defers its e2e coverage. Route and component tests are useful, but neither verifies browser reload/cache behavior with a persisted brief.
- **AC-33 failure logging is not fully covered.** AC-26 requires one log for success or failure; T13’s stated log assertion is success-only. Add provider-unavailable, validation-failure, timeout, and input-preparation-failure log tests.
- **AC-17 says counts appear in response metadata and logs.** T13 checks logs; T12/route tests should explicitly assert response `meta.grounding` values after mixed valid/invalid output.
- **AC-23 invalid output -> 502 is not explicitly tested at the route layer.** T12 tests a rejection/failure, but a malformed structured-output result and a transport error are different paths. Add a malformed result test with unchanged existing row.
- **AC-43 says no Intent derivation.** T12 refers to “intent repo’s write and derive,” but the proposed dependency is `IntentRepository.getIntent`; the plan should prove no `IntentService` is constructed/called rather than test methods that may not exist on the injected repository.
- **AC-44’s degraded behavior is broader than the spec.** The plan marks blast missing when `paths` is empty, even if repo intel is healthy. The AC specifically describes degraded index plus no changed symbols. Define whether a valid empty blast result is “missing,” “no callers,” or “available.”
- **AC-48 is not covered correctly due to T10/R9 conflation of empty and unavailable diffs.**
- **AC-35–AC-37 use different definitions of “in PR diff.”** Server grounding uses `loadDiff`; client validation uses `pr.files`. R5’s assertion that a server-grounded path is always in `pr.files` is unsupported and can be false when data sources are stale or represent renames/deletions differently.
- **T28 says IntentBlock and BlastRadiusBlock render inside the card “in every state.”** That is extra behavior, potentially costly and confusing in the no-brief empty state; AC-5/AC-6 only require them when a brief is shown. It also means those child blocks may independently fetch/mutate while the card is loading.
- **P1’s “contract freeze” is not truly frozen before implementation.** T4 may require downstream changes, and P4 is allowed after P1 while server work is still defining route response semantics, failure details, and metadata behavior. Freeze an API fixture/OpenAPI-equivalent response contract, not only TypeScript types.

### Schema and structured-output design

- `BriefModelOutput` “with no `.max()`, `.min()`, or `.optional()`” is not sufficient to establish provider compatibility. Strict JSON-schema providers commonly require every object to have `additionalProperties: false`; plain Zod objects may not produce that. T5 should inspect the exact emitted schema requirements for each supported provider, not only banned keywords.
- The model output schema has no output-size limits because caps are applied after receipt. This allows oversized arrays/strings to reach application memory before `clampOutput`. Set adapter output-token limits and impose a response-byte cap before parsing where possible.
- T5 requires all properties to be “required,” but nullable values and optional model fields need a deliberate schema design. Do not rely on Zod’s default stripping of unknown properties as an implicit security decision; decide whether unknown output fields are rejected, stripped, or logged.
- `line_adjusted` is included in the shared returned object but apparently model output should not control it. Ensure it is added exclusively by grounding and absent from `BriefModelOutput`.
- The plan should validate the **post-grounding** object against `PrBrief` before storage, not only the raw LLM output. This catches mistakes in clamping/normalization/snapshot composition.

### Concurrency, timeout, and cache semantics

- The in-memory limiter is safe from a JavaScript-thread race only if check-and-set occurs without an `await`; the plan says this but should make it a small atomic function and test concurrent `Promise.all` admissions. It remains intentionally ineffective across processes/restarts, which is accepted, but it invalidates the edge-case promise that “the first request wins” globally.
- A 429’s GET refetch can still return no brief if the first request is in flight. AC-32 wording “which picks up the brief the first request produced” is timing-dependent and false at the time of the immediate GET. The UI should refetch once immediately for state reconciliation, then either poll/retry after `Retry-After` or clearly say generation is in progress.
- Cooldown starts at admission. A provider failure immediately blocks retry for 30 seconds. This is implied by AC-31 but likely undesirable for missing configuration or local validation failure. Decide whether all failures count, especially failures before any provider call.
- Cache overwrite semantics are undefined when the current head changes during generation, when a brief is generated with missing diff, or when dependencies are degraded. A degraded brief may overwrite a complete prior brief. Consider keeping the prior complete brief and returning an error/degraded result unless the user explicitly chooses replacement.

### Security and path handling

- Grounding must store the canonical allow-list path, not the model’s normalized input. For `./src/a.ts`, matching after normalization but storing `./src/a.ts` violates AC-13’s “only … path in the PR diff” and breaks client matching. T8 should assert canonical stored values.
- Define path validation before prompt construction and navigation: reject/control-normalize NULs, absolute paths, `..` traversal segments, duplicate separators, and excessively long paths. Exact matching protects stored references, but all paths are also untrusted prompt/UI/URL data.
- The current injection control is model guidance, not an enforcement boundary. Delimiters such as `<untrusted source=...>` need escaping or an encoding strategy; attacker-controlled text can contain closing tags or fake source tags. Use a structured JSON data block or escape delimiters, retain role separation, and add adversarial tests containing fake delimiters and instructions.
- Do not log raw provider errors if they may echo prompt content, document contents, repository paths, or credentials. AC-26 asks for structured fields, but the error field itself is not constrained.
- Workspace authorization needs to apply before all reads that can reveal existence or metadata. AC-49 says 404 for no PR and 403 cross-workspace; define whether lookup is workspace-scoped to avoid an ID enumeration side channel.
- `RefResolver` content is intentionally sent to the model but not persisted. The spec should state retention/logging behavior for it in provider telemetry and tracing, not merely DB persistence.

### Accessibility and navigation gaps

- T31 does not cover `aria-expanded`, `aria-controls`, and accessible names for the risk disclosure control in AC-51. “Risk and focus items are buttons” is insufficient if a risk row both expands and navigates.
- The plan says “clicking a risk” navigates in T23 while AC-51 says expanding a risk uses a chevron. Define separate controls. A single clickable expandable card is ambiguous for keyboard and screen-reader users.
- URL-driven scrolling should not silently steal focus. Define focus behavior for deep links and use reduced-motion-aware scrolling. Add a test that the highlight is announced or otherwise discoverable, not just visually colored.
- The “not in diff” toast is one-time only, but its trigger needs reset semantics on URL changes. Otherwise navigating from unknown file A to unknown file B may produce no feedback.
- `router.replace` is appropriate for transient navigation, but it prevents Back from returning to Overview. This may be intentional; specify it and test expected history behavior.
- The requirement “severity is not conveyed by color alone” is only tested informally in T22. Assert visible severity text or an icon with accessible label in component tests.

## Minor

- “55 ACs are atomic and testable” in the plan’s spec gate is inaccurate. Many ACs are implementation/verification prescriptions rather than acceptance criteria. The embedded `Verify:` blocks should move to a verification matrix; the ACs should describe observable behavior.
- **Redundant/over-specified AC clusters:**
  - AC-4 is partially decomposed by AC-8 and AC-9; retain AC-4 as the state transition and move detailed presentation to the latter.
  - AC-10 and AC-30 overlap substantially. AC-10 can cover availability/action of Regenerate; AC-30 can cover successful replacement/new generation.
  - AC-13 and AC-14 are appropriately related but can be one grounding invariant with two test cases.
  - AC-19/21/22 are a single budget-management requirement split reasonably, but exact truncation ordering and marker wording are implementation-specific unless product needs deterministic auditability.
  - AC-43 overlaps AC-7, AC-18, and AC-45. Keep the important “must not derive Intent” negative guarantee, but do not repeat generic one-call/missing-list behavior there.
  - AC-50 is a separate existing-review feature presented as a wish. It is unrelated to brief generation and should be a separate spec or omitted from this feature.
  - AC-54’s exact namespace/file path and grep test are implementation details, not product acceptance criteria.
  - AC-55’s exact placement/content of stats and source chips is design-level detail; it can be reduced to “show deterministic diff stats and source resolution status.”
- The spec calls risks “each tied to a file,” then permits blast-only caller files, while navigation only supports diff files. This is acceptable only if risk rendering clearly distinguishes “changed file” from “caller/blast file” and provides no deceptive navigation affordance.
- Input section ceilings claim specs/docs are “≤32 KB per doc,” while the prompt budget permits only 900 estimated tokens total for docs. Clarify whether only one resolved doc is sent and whether labels/statuses for omitted docs remain visible to the model.
- The plan’s status derivation (`added` only if exactly one `0,0` hunk) can misclassify a newly added file with multiple hunks. It should use diff headers/status metadata, or omit status rather than produce incorrect facts.
- `changed line ranges` include context lines according to the plan. The spec calls them changed new-side line ranges, which normally excludes context. This affects grounding and the truthfulness of a “focus changed line” affordance. Define whether context is intentionally navigable.
- `tokens_in`, `tokens_out`, and `cost_usd` need nullable semantics when a provider fails before reporting usage. The frozen contract currently makes both token fields required integers.
- `generated_at` needs a defined format, timezone, and clock source; use ISO 8601 UTC and validate it.
- The UI’s missing-data message should distinguish unavailable/error from genuinely absent inputs. A missing linked issue is different from a linked issue fetch failure; sources status partially covers it, but the summary note does not.
- T34 maps documentation work to AC-26 even though documentation is not part of that AC. It is a task without an AC, which is fine, but should be marked as housekeeping rather than artificial coverage.
- The claimed multi-agent parallelism is mostly feasible after P1, but P5/P6 both depend on card API decisions made in P4, and P7 touches `page.tsx` after P6. Require an interface handoff checkpoint after P4 and avoid parallel edits to shared `OverviewTab/page.tsx` helpers.

## Top-5 changes

1. **Redefine and enforce the one-call contract.**  
   Update AC-18/G3/US-7 and T12/T9 to distinguish `generation_operations`, `provider_request_count`, `transport_retry_count`, and `schema_attempts`. If the product promise is one billed call, use `maxRetries: 0`, disable hidden retries for this operation, and assert exactly one outbound provider request in adapter-level tests.

2. **Fix diff result modeling before implementing grounding/navigation.**  
   Replace `UnifiedDiff | null` with explicit `loaded-empty` versus `unavailable` status. Either add deterministic support for deleted/rename/binary metadata or remove those promises from the spec. Update AC-16/AC-48 and add tests for loaded-empty PR, unavailable diff, deletion, rename, and binary files.

3. **Add conditional persistence and generation freshness checks.**  
   Capture generation head SHA/request ID, reread current head before write, and use compare-and-swap logic to prevent old requests from overwriting newer briefs. Return computed `stale`, never hard-coded `false`. Add out-of-order completion, commit-during-generation, timeout, and multi-process behavior tests.

4. **Replace section-sum budgeting with exact serialized-payload budgeting.**  
   Reserve explicit framing overhead, serialize first, then deterministically reduce variable sections until the actual `ceil(chars/4)` estimate is <=8,000. Define a typed pre-call failure if immutable content exceeds the budget. Test escaped adversarial strings, wrappers, markers, long paths, and all sections at maximum size.

5. **Contain the contract change and close unresolved decisions.**  
   Formally resolve OQ-3 and introduce either a versioned `PrBrief`/compatibility parser or a new brief-specific risk schema instead of tightening global `Risk.file_refs`. Define old-row GET behavior, canonical `missing` ordering, nullable usage/cost fields, and post-grounding validation. Expand T4 from “expected none” to a complete consumer/persistence inventory.

## Triage (author's response)

Cross-model review model: `openai/gpt-5.6-terra-pro` via OpenRouter. Input: spec + plan only (no code, no env). Cost about 0.42 USD, 131k tokens.

| Review item | Decision | Where applied |
|---|---|---|
| B1 "exactly one call" vs `maxRetries: 1` | Kept `maxRetries: 1`. Wording fixed: one `completeStructured` call, up to 2 `schema_attempts`, transport retries not counted | spec D-7, AC-18, AC-26; plan T9, T12 |
| B2 empty vs unavailable diff; deleted/rename/binary promises | Accepted. `loaded` (maybe 0 files) vs `unavailable`; deleted/pure-rename/binary excluded by `diffFacts` on both loader paths | spec D-8, AC-48, AC-59-61; plan T6, T10 |
| B3 stale overwrite | Partly: `stale` is computed from re-read head SHA; no compare-and-swap (last write wins) | spec AC-27, AC-77; plan T13 |
| B4 budget arithmetic | Accepted: 1,500 framing reserve, exact serialized payload (+ output schema), typed pre-call failure instead of throw | spec AC-19, AC-64; plan T7, T39 |
| B5 shared contract blast radius | Accepted: shared `Risk` unchanged; server-only `PrBriefStored` enforces file_refs >= 1 | spec AC-84; plan T1, T37 |
| Injection delimiters, canonical paths, path rejection, sanitized errors | Accepted | spec AC-62, 63, 65-67; plan T36, T38, T40 |
| `status` derived from hunks | Accepted: removed | spec AC-20; plan T6 |
| Access ACs split, GET 403, retry_after rounding | Accepted | spec AC-49, 56-58, 72 |
| Separate expand vs navigate controls, focus/reduced-motion, toast per URL change | Accepted | spec AC-73-76, 83; plan T22, T23, T26, T41 |
| 429 UX wording | Accepted | spec AC-32; plan T18 |
| Merge/trim 55 ACs | Rejected (large rewrite; kept) | - |
| VerdictBanner AC-50 out of scope | Rejected (P3 in the assignment) | - |
| Intent/Blast blocks only when a brief exists | Rejected (design and D-2) | - |
| Multi-process rate limit | Rejected (accepted limitation) | plan R9 |
| Interface checkpoint for parallel tracks | Accepted | plan T42, section 9 |
