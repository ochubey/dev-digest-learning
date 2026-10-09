# Spec: PR Why + Risk Brief
Spec ID: SPEC-01
Status: approved

Revision note: revised after the cross-model review (`docs/plans/pr-brief-cross-review.md`) and the user's decisions. AC numbering is stable: existing ACs keep their ids, new ACs are appended as AC-56 and up, and no AC was removed. OQ-1..OQ-6 are resolved as decisions D-1..D-6, and OQ-7..OQ-12 as decisions D-9..D-14 (see "Decisions").

Revision 4 note: two user-requested additions derived from the design prototype (`screen_pr_detail.jsx`): (A) an optional line range (`anchor`) per risk, grounded by code against the risk's file refs and the hunk new-side ranges (AC-85..AC-100, D-15..D-19), and (B) the brief's own generation cost and token usage in the card header (AC-101..AC-107, D-20). The shared `Risk` schema is extended with one optional field; it is still not tightened (D-15 amends D-4 and AC-84). Existing AC ids and texts are unchanged apart from cross-references.

## Problem and user

A reviewer opens a pull request cold. The pieces needed to orient are scattered: Intent (L03) and Blast radius (L04) are separate blocks on the Overview tab, Smart Diff roles live on the Files changed tab, and nothing says where the risk is or which lines to read first. The reviewer has to assemble that picture by hand before the review starts.

User: a DevDigest reviewer looking at one PR in a workspace they belong to.

The PR Brief puts that picture in one card on the Overview tab. It combines the facts the system already computes (Intent, Blast radius summary and caller files, diff stats and Smart Diff roles, linked issue, referenced spec/plan docs) with three parts written by the model: a short summary of what the PR does and why, Risk areas (each tied to at least one file), and Review focus (`file:line`, plus why to start there). Each generation makes exactly one structured completion call (`completeStructured`); schema-validation reprompts inside that call are counted as attempts, not as extra calls. The model gets only precomputed facts, never diff hunk bodies. Every file the model names is checked by code against the PR diff and the blast map.

## Goals / Non-goals

### Goals

- **G1 Orientation in one card.** On the Overview tab, one PR Brief card shows the summary, Intent, Blast radius, Risk areas and Review focus.
- **G2 Grounded output.** Every file reference in Risk areas and Review focus is a real, canonical path from the PR diff or the blast map. The model never sees hunk bodies.
- **G3 Predictable cost.** One generation = exactly one `completeStructured` call. Schema-validation reprompts inside that call are counted as `attempts` (`maxRetries: 1`, so at most 2 attempts) and transport retries are not counted; the log shows `brief=1 ok` plus `schema_attempts`. The input stays within a fixed budget measured on the exact serialized messages, the output is validated against the contract, and the model comes from the `risk_brief` setting.
- **G4 Persistence.** A brief is cached per PR and tied to the head commit SHA it was generated from. A reload shows it without regenerating. Its stale flag is always computed against the current head SHA, and it can be regenerated on demand.
- **G5 Navigation.** Clicking a Review focus item (and, as a wish, a risk file reference) opens Files changed on that file and line. The location is addressable by URL, so it survives a reload.
- **G6 Graceful degradation.** The brief still generates when Intent, Blast radius, the linked issue, specs, the description or the diff are missing, and it says explicitly what was missing. Rate-limit, budget and model failures are reported clearly and never destroy an existing brief.

### Non-goals

- "Prior PRs touching these files" (history accordion from the design). The assignment explicitly says it is not needed. `PrBrief.history` is optional and not populated by this feature.
- Auto-deriving Intent as part of brief generation. Intent is used only if it already exists (user decision).
- Sending diff code or hunk bodies to the model. Only paths, Smart Diff roles, addition/deletion counts and hunk new-side line ranges (D-9) are sent.
- A per-file change status (`added` / `modified` / ...) in diff facts. It is not reliably derivable from the loaded diff, so it is neither sent to the model nor shown.
- Deleted, pure-rename and binary files. The brief excludes them from the diff facts (user decision; the git path drops them in the parser, and the diff facts filter the rest); references to them are dropped by grounding, and there is no focus, grounding or navigation behavior specific to them.
- A guarantee of a single billed provider request. Up to 2 schema attempts are allowed inside the one call, and adapter transport retries are not counted.
- Compare-and-swap or versioned writes across concurrent generations. The last successful write wins; freshness is conveyed by the computed stale flag.
- A model-produced verdict or score. VerdictBanner (P3) shows data from existing review runs only.
- Automatic regeneration when a new commit arrives. The brief is only marked stale.
- Brief version history, editing a brief, posting a brief to GitHub, streaming partial output.
- Rate limiting shared across server instances. The limiter is in-memory per process, like Intent.
- Model fallback. If the `risk_brief` provider is unusable, generation fails (D-5).
- Tightening the shared `Risk` schema. `Risk.kind` stays a free string and `Risk.file_refs` gets no `min(1)` (D-4, AC-84). Adding the one optional `anchor` field (D-15, AC-85) is an extension, not a tightening.
- More than one anchor per risk, anchors on blast-only files, and a flag or count for clipped anchors (D-17).
- Storing anything new for the cost/tokens header line; it reads the existing `meta` fields (D-20).
- Project Context Folder documents. No such module exists in the server today (`SpecFile` is a contract only). "Attached specs" means the spec/plan docs the PR references, as resolved by RefResolver (user decision).

## User stories

- **US-1 (G1, G6).** As a reviewer opening a PR with no brief, I see a PR Brief block with a Generate brief button, so I can ask for orientation on demand.
- **US-2 (G1, G2, G3).** As a reviewer, after I click Generate I see a short summary, Risk areas (each with a name and at least one file) and Review focus (`file:line — reason`), next to Intent and Blast radius when they exist.
- **US-3 (G6).** As a reviewer on a PR without Intent or Blast radius, I still get a brief, and it tells me which inputs were missing.
- **US-4 (G5).** As a reviewer, I click a Review focus item and land in Files changed on that file and line. The URL keeps that location.
- **US-5 (G4).** As a reviewer, I reload the page and the same brief appears immediately, without a new model call.
- **US-6 (G4).** As a reviewer, I see when the brief was generated for an older commit than the current head, and I can regenerate it.
- **US-7 (G3).** As an operator, I can confirm from the log line that one generation made exactly one `completeStructured` call (`brief=1 ok`), how many schema attempts it took (`schema_attempts`), that the input stayed within the budget and which model was used.
- **US-8 (G2, G5).** As a reviewer, I see a risk pinned to a line range such as `src/middleware/ratelimit.ts:12-18`, and its navigate button opens Files changed at the first line of that range.
- **US-9 (G3).** As a reviewer, I see in the brief header what this brief cost to generate and how many tokens it used (for example `$0.014  8.2K→1.3K`).

## Acceptance criteria (EARS)

Each AC carries its priority (P1 blocking, P2 required, P3 wish) and its goal.

### Overview block and generation (G1)

- **AC-1 (P1, G1).** ПОКИ the Overview tab of a PR is open and no brief is stored for that PR, the system (shall) show a PR Brief block with an empty state and a "Generate brief" button.
  *Verify:* client component test with GET brief returning 404 renders the empty state and the button. e2e on a seeded PR without a brief.
- **AC-2 (P1, G1).** КОЛИ the reviewer clicks "Generate brief", the system (shall) request a new brief for that PR (POST `/pulls/:id/brief`).
  *Verify:* component test asserts one POST on click.
- **AC-3 (P1, G1).** ПОКИ a generation request is in flight, the system (shall) disable the Generate/Regenerate control and show a busy indicator on it.
  *Verify:* component test with a pending mutation asserts a disabled button with a busy state.
- **AC-4 (P1, G1).** КОЛИ generation succeeds, the system (shall) show the summary, the Risk areas list and the Review focus list in the PR Brief block without a page reload.
  *Verify:* component test resolves the POST with a fixture and asserts all three sections render.
- **AC-5 (P1, G1).** ПОКИ a brief is shown and Intent exists for the PR, the system (shall) show the live Intent block (summary, in-scope and out-of-scope lists) inside the PR Brief card.
  *Verify:* component test with an Intent fixture.
- **AC-6 (P1, G1).** ПОКИ a brief is shown and Blast radius data is available for the PR, the system (shall) show the live Blast radius block (summary line and caller files) inside the PR Brief card.
  *Verify:* component test with a blast fixture.
- **AC-7 (P1, G1, G6).** ЯКЩО Intent or Blast radius was missing when the brief was generated, ТОДІ the system (shall) show an explicit missing-data note naming each missing input (for example "Generated without: Intent, Blast radius").
  *Verify:* component test with `missing: ['intent','blast']` asserts the note text. Integration test on a PR with no `pr_intent` row and a degraded index asserts `missing` contains both.
- **AC-8 (P1, G1).** The system (shall) show each risk with its title and at least one file path.
  *Verify:* component test asserts the title and the first `file_refs` entry per risk. Grounding test asserts every stored risk has at least one ref (AC-14); the brief-specific stored schema rejects a risk with zero refs (AC-84).
- **AC-9 (P1, G1).** The system (shall) show each Review focus item as `file:line — reason`, in the order returned.
  *Verify:* component test asserts rendered text and order.
- **AC-10 (P1, G1).** ПОКИ a brief is shown, the system (shall) offer a Regenerate (refresh) control in the PR Brief card header that requests a new brief.
  *Verify:* component test clicks Regenerate and asserts a POST.
- **AC-11 (P1, G1).** ЯКЩО the stored brief has no risks after grounding and `meta.missing` does not include `diff`, ТОДІ the system (shall) show the `noRisks` label ("No notable risks flagged.") in place of the Risk areas list. ЯКЩО the stored brief has no risks and `meta.missing` includes `diff`, ТОДІ the system (shall) instead show a single notice that risks could not be assessed because the PR diff was unavailable (i18n key `card.risksNotAssessed`), and not the `noRisks` label.
  *Verify:* component test with `risks: []` and `missing: []` asserts the `noRisks` text; component test with `risks: []` and `missing` containing `diff` asserts the `card.risksNotAssessed` notice and no `noRisks` text.
- **AC-12 (P1, G1).** ЯКЩО the stored brief has no Review focus items after grounding and `meta.missing` does not include `diff`, ТОДІ the system (shall) show an explicit empty message for Review focus instead of hiding the section. ЯКЩО the stored brief has no Review focus items and `meta.missing` includes `diff`, ТОДІ the system (shall) not render the Review focus section (no empty message).
  *Verify:* component test with `review_focus: []` and `missing: []` asserts the empty message; component test with `review_focus: []` and `missing` containing `diff` asserts that neither the Review focus section nor its empty message is rendered.

### Grounding: no invented paths (G2)

- **AC-13 (P1, G2).** The system (shall) store and return only risk file references that are either a path in the PR diff facts or a caller file in the blast map at generation time.
  *Verify:* service unit test with a stubbed LLM returning one valid and one invented path asserts that only the valid one survives.
- **AC-14 (P1, G2).** ЯКЩО all file references of a risk are dropped by grounding, ТОДІ the system (shall) drop that risk.
  *Verify:* service unit test.
- **AC-15 (P1, G2).** The system (shall) store and return only Review focus items whose file is a path in the PR diff facts (decision D-1: focus items must be openable in Files changed; blast-only files are allowed in risks only).
  *Verify:* service unit test with a blast-only path and an invented path asserts both are dropped.
- **AC-16 (P2, G2).** ЯКЩО a Review focus line lies outside every hunk new-side line range of its file (the range a hunk covers on the new side, context lines included, D-9), ТОДІ the system (shall) replace it with the start line of the nearest hunk range in that file (tie: the earlier range) and mark the item `line_adjusted`. Only files present in the diff facts reach this rule (deleted, pure-rename and binary files are never there, AC-60).
  *Verify:* service unit test with hunk ranges `[10-20, 50-60]` and model line 35 asserts line 50 (distance 15 vs 25) and `line_adjusted: true`. Line 30 (tie at 20) asserts line 10. A line that falls on a context line inside a hunk range is kept unchanged with no `line_adjusted`.
- **AC-17 (P2, G2).** The system (shall) record per generation the number of dropped risks, dropped file references, dropped focus items and adjusted lines, return them in the response metadata, and write them to the generation log line. (Dropped risk anchors are added by AC-93 and AC-94.)
  *Verify:* service test with mixed valid/invalid output asserts `meta.grounding` counts in the response. Log assertion in the route test.

### Model call, input and output (G3)

- **AC-18 (P2, G3).** КОЛИ an admitted generation's input fits the budget, the system (shall) make exactly one `completeStructured` call with `maxRetries: 1`. Schema-validation reprompts inside that call are counted as `schema_attempts` (at most 2); transport retries are not counted. The log line (shall) show `brief=1 ok` (or the failure outcome) plus `schema_attempts`.
  *Verify:* route/service test with a spy LLM asserts one `completeStructured` call with `maxRetries: 1`; the captured log line contains `brief=1` and `schema_attempts=<n>`.
- **AC-19 (P2, G3).** The system (shall) keep the model input at or below 8,000 estimated tokens, where estimated tokens = ceil(characters / 4) of the exact serialized system and user messages, including instructions, output schema, injection guard, delimiters, source labels, truncation markers and escaping.
  *Verify:* unit test of the input builder with oversize and worst-case fixtures (2,000-file PR with long paths, 100 KB description full of characters that need escaping, 64 KB spec, all wrappers and markers present) asserts ceil(len(serialized messages)/4) ≤ 8,000.
- **AC-20 (P2, G3).** The system (shall) never include diff hunk bodies (added, removed or context code lines, or the code context text after a hunk header) in the model input. Only file paths, Smart Diff role, addition/deletion counts and hunk new-side line ranges (D-9) are allowed per file; no change status is sent.
  *Verify:* builder unit test with a diff containing a sentinel string in a hunk body and in a hunk-header context asserts the sentinel is absent from the messages; asserts no `status` field per file row.
- **AC-21 (P2, G3).** ЯКЩО the assembled input exceeds a section ceiling or the total budget, ТОДІ the system (shall) truncate sections in this order, lowest priority first: (1) referenced spec/plan docs, (2) linked issue body, (3) PR description, (4) blast caller list, (5) diff-stats rows. It (shall) never truncate the instructions, the PR title, the Intent summary, the blast summary line or the missing-data list. See "Input budget".
  *Verify:* builder unit tests per step assert which section was cut first and that protected sections are intact.
- **AC-22 (P2, G3).** КОЛИ a section is truncated, the system (shall) insert a visible truncation marker in that section and record the section name in the brief's input metadata.
  *Verify:* builder unit test asserts the marker and `input.truncated` contents.
- **AC-23 (P2, G3).** The system (shall) validate the model response against the brief model output schema (`summary`, `risks[]`, `review_focus[]`) before grounding and storage.
  *Verify:* route test where the stub returns a malformed structured result asserts 502 and an unchanged stored row.
- **AC-24 (P2, G3).** The shared `PrBrief` contract (shall) be identical in the server and client copies and (shall) contain: `summary`; `risks[]`; `review_focus[{file, line, reason, line_adjusted?}]`; nullable `intent` and `blast` snapshots; optional `history`; and a `meta` object (`generated_from_head_sha`, `generated_at`, `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `schema_attempts`, `missing[]`, `sources[]`, `diff_stats`, `input{estimated_tokens, budget_tokens, truncated[], blast_degraded_reason}`, `grounding{dropped_risks, dropped_refs, dropped_focus, adjusted_lines}`). The GET/POST response adds `pr_id` and `stale` (decision D-3). (Extended by AC-85, AC-95 and AC-96: optional `Risk.anchor` and optional `grounding.dropped_anchors`.)
  *Verify:* typecheck in both packages. A unit test parses one fixture with both copies, or a diff check between the two files.
- **AC-25 (P2, G3).** The system (shall) select the provider and model from the workspace's `risk_brief` feature-model setting (default `openai` / `gpt-4.1`), never from a hard-coded value.
  *Verify:* route test with a workspace override asserts the LLM was called with the overridden model. The stored metadata records `provider` and `model`.
- **AC-26 (P2, G3).** КОЛИ generation completes (success or any failure, including failures before a provider call), the system (shall) emit one log line with: PR id, call count (`brief=0|1`) and `schema_attempts`, provider/model (when resolved), estimated input tokens (when computed), provider-reported tokens in/out (or null), cost (or null), truncated sections, grounding drop counts (when grounding ran), and outcome, one of: `ok`; `invalid_output` (the model output fails the output schema, AC-23, or the post-grounding brief fails the stored schema, AC-68); `input_over_budget` (AC-64); `timeout` (AC-82); `provider_unavailable` (AC-81); `provider_error` (any other provider call failure, AC-33, and also a database failure while storing the brief, which is reported as a `provider_error`-class failure with the fixed text "The brief could not be stored"; there is no separate outcome value for it).
  *Verify:* route tests capture the logger output for success, provider-unavailable, provider error, invalid model output, post-grounding validation failure, timeout and input-over-budget, and assert the matching outcome value. A service test with a throwing brief repository write asserts outcome `provider_error` and the error text "The brief could not be stored".

### Cache, staleness, refresh (G4)

- **AC-27 (P1, G4).** КОЛИ generation succeeds, the system (shall) store the brief for the PR together with the head commit SHA its inputs were gathered at, replacing any previous brief for that PR (last successful write wins).
  *Verify:* integration test (`.it.test.ts`) asserts one `pr_brief` row whose JSON contains `generated_from_head_sha`.
- **AC-28 (P1, G4).** КОЛИ the Overview tab loads for a PR with a stored brief, the system (shall) show that brief without making a model call.
  *Verify:* route test: GET with a spy LLM asserts zero calls. e2e: reload shows the same summary text.
- **AC-29 (P2, G4).** ПОКИ the stored brief's `generated_from_head_sha` differs from the PR's current head SHA, the system (shall) show the brief with a "stale" badge and a Regenerate control. The `stale` flag in every GET and POST response (shall) be computed from the current head SHA re-read when the response is built, and never hard-coded.
  *Verify:* route test asserts `stale: true` on GET after `head_sha` changes. Component test asserts the badge.
- **AC-30 (P1, G4).** КОЛИ the reviewer clicks Regenerate, the system (shall) generate a new brief with a new model call and replace the shown brief on success.
  *Verify:* component and route test.
- **AC-31 (P2, G4).** ЯКЩО a generation for the same PR was admitted less than 30 s ago, regardless of its outcome (success, model failure, or a failure before any provider call such as a missing provider key or an over-budget input), ТОДІ the system (shall) reject the request with HTTP 429, a `Retry-After` header and a body `{error, retry_after}`, without calling GitHub or the model.
  *Verify:* route test with two POSTs in a row; a second route test where the first POST fails with provider-unavailable and the second still gets 429.
- **AC-32 (P2, G4).** ЯКЩО the server answers 429, ТОДІ the client (shall) keep showing the current brief (or the empty state), refetch the stored brief exactly once, and show a message that generation was recently started, with the remaining seconds. The message (shall) not claim that a brief exists.
  *Verify:* component test with a 429 response asserts one GET refetch and the message text; with the refetch returning 404 the empty state remains and no "brief ready" wording appears.
- **AC-33 (P2, G6).** ЯКЩО the model call fails or its output fails validation, ТОДІ the system (shall) answer HTTP 502 `{error, retry_after}` and keep the previously stored brief unchanged.
  *Verify:* integration test: seed a brief, make the stub throw, assert 502 and an unchanged row.
- **AC-34 (P2, G6).** ЯКЩО generation fails, ТОДІ the system (shall) show an error message with a retry option and keep the previously shown brief visible.
  *Verify:* component test with a 502 response.

### Navigation to Files changed (G5)

- **AC-35 (P1, G5).** КОЛИ the reviewer clicks a Review focus item whose file is in the PR diff, the system (shall) switch to the Files changed tab (`?tab=diff`) and open (expand) that file.
  *Verify:* component/e2e test asserts the URL `tab=diff` and an expanded file card for that path.
- **AC-36 (P1, G5).** КОЛИ such navigation happens, the system (shall) put the target into the URL as `?tab=diff&file=<url-encoded path>&line=<n>`.
  *Verify:* component test asserts the `router.replace` argument.
- **AC-37 (P1, G5).** КОЛИ the PR page loads with `tab=diff` and a `file` parameter naming a PR file, the system (shall) open that file in Files changed. This covers reload and shared links.
  *Verify:* DiffTab test with search params.
- **AC-38 (P2, G5).** КОЛИ Files changed opens with `file` and `line` parameters and that line is rendered in the file's diff, the system (shall) scroll to that line and highlight it.
  *Verify:* DiffTab test asserts a scroll call on the line row and the highlight state. e2e on a seeded PR.
- **AC-39 (P2, G5).** ЯКЩО the `line` parameter is not rendered in the file's diff, ТОДІ the system (shall) scroll to the file header instead.
  *Verify:* DiffTab test.
- **AC-40 (P2, G5).** КОЛИ the reviewer switches tabs through the tab bar, the system (shall) clear the `file` and `line` parameters.
  *Verify:* page test asserts the params are removed.
- **AC-41 (P3, G5).** ЯКЩО the reviewer activates navigation for a file reference that is not in the PR's current diff (a blast-only risk reference, or, after a later commit, a file no longer in the diff), ТОДІ the system (shall) stay on the current tab and show the toast "File not in this PR's diff". Focus items are diff files at generation time (AC-15), so for them this happens only after a later commit.
  *Verify:* component test asserts the toast and no navigation.
- **AC-42 (P3, G5).** КОЛИ the reviewer activates a risk file reference's navigate control, the system (shall) navigate to that file by the same rules as Review focus (AC-35, AC-41). (The target line for an anchored file is defined by AC-100.)
  *Verify:* component test.

### Degradation (G6)

- **AC-43 (P1, G6).** ЯКЩО Intent has not been derived for the PR, ТОДІ the system (shall) generate the brief without Intent, still with exactly one `completeStructured` call, and without deriving Intent.
  *Verify:* route test: no `pr_intent` row, a spy asserts no Intent derivation path is invoked, the LLM spy asserts one call, `missing` contains `intent`.
- **AC-44 (P1, G6).** ЯКЩО the repo-intel index is degraded and reports no changed symbols, ТОДІ the system (shall) treat Blast radius as missing, generate the brief, and record the degradation reason in the input metadata.
  *Verify:* route test with a degraded `getBlastRadius` stub.
- **AC-45 (P2, G6).** The system (shall) record a deterministic `missing` list per brief, containing only values from {`intent`, `blast`, `description`, `linked_issue`, `specs`, `diff`} and always in this canonical order: `intent, blast, description, linked_issue, specs, diff`. The model input states the same list in the same order.
  *Verify:* builder unit test feeds the missing inputs in shuffled detection order and asserts the canonical order in metadata and in the prompt.
- **AC-46 (P2, G6).** The system (shall) resolve the linked issue and referenced spec/plan docs live through RefResolver at generation time, and store only code-owned source labels with a status (`fetched` / `unavailable` / `error`), never contents, titles or URLs. The labels are the fixed strings "PR title", "PR body", "Changed files", and for resolved references "Linked issue #<number>", "Spec at <repo-relative path>", "Plan at <repo-relative path>" and "Issue #<number> (other repository)" (D-12).
  *Verify:* integration test asserts the stored JSON has `sources` whose labels match these patterns and no document body, title or URL. A sentinel string from the spec fixture is absent from the row.
- **AC-47 (P2, G6).** ЯКЩО resolving the linked issue or a referenced doc fails, ТОДІ the system (shall) continue generation and record that source's status as `error` or `unavailable`.
  *Verify:* service test with a throwing GitHub stub.
- **AC-48 (P2, G6).** ЯКЩО the PR diff is unavailable (it cannot be loaded), ТОДІ the system (shall) generate without diff stats, record `diff` as missing, and ground only against blast caller files. Review focus is then empty per AC-15. A diff that loads with zero files is not unavailable (AC-59).
  *Verify:* route test with a throwing diff loader asserts `missing` contains `diff` and `review_focus: []`.

### Access (cross-cutting)

- **AC-49 (P1, G4).** ЯКЩО the PR does not exist, ТОДІ GET `/pulls/:id/brief` (shall) answer 404. (POST and 403 cases moved to AC-56..AC-58.)
  *Verify:* route test.

### Wishes (P3)

- **AC-50 (P3, G1).** ДЕ a review run exists for the PR, the system (shall) show VerdictBanner above the brief with the latest verdict and PR score. It (shall) hide the banner when no run exists.
  *Verify:* component test with and without reviews.
- **AC-51 (P3, G1).** КОЛИ the reviewer activates a risk's expand control, the system (shall) show its explanation and all of its file references. The expand control (shall) be a chevron button with `aria-expanded`, `aria-controls` pointing at the expanded region, and an accessible name that includes the risk title.
  *Verify:* component test toggles the chevron and asserts `aria-expanded` flips, `aria-controls` matches the region id, and the accessible name.
- **AC-52 (P3, G1).** ПОКИ the first generation is in flight, the system (shall) show a two-column skeleton below the empty state, with the "Generate brief" button still visible but disabled.
  *Verify:* component test with a pending first generation asserts the skeleton is rendered after the empty state, and the "Generate brief" button is present and disabled.
- **AC-53 (P3, G1).** ПОКИ a regeneration is in flight, the system (shall) keep the previous brief visible and dimmed, with a "Regenerating…" indicator, instead of a skeleton.
  *Verify:* component test.
- **AC-54 (P3, G1).** The system (shall) take all brief UI labels from the `brief` message namespace (`client/messages/en/brief.json`), reusing the existing keys (`block.intent`, `block.blast`, `block.risks`, `noRisks`, `unavailable`, `unavailableHint`) and adding new keys for the new strings.
  *Verify:* a grep for hard-coded English in the brief components. The i18n test passes.
- **AC-55 (P3, G1).** ПОКИ a brief is shown, the system (shall) show the deterministic diff stats (files, +additions/−deletions, file count per Smart Diff role) and the resolved sources with their statuses.
  *Verify:* component test.

### Added in revision 2 (AC-56 and up)

Access

- **AC-56 (P1, G4).** ЯКЩО the PR belongs to a workspace the caller is not a member of, ТОДІ GET `/pulls/:id/brief` (shall) answer 403 without returning any brief data.
  *Verify:* route test with a PR in another workspace and a seeded brief asserts 403 and no brief fields in the body.
- **AC-57 (P1, G4).** ЯКЩО the PR does not exist, ТОДІ POST `/pulls/:id/brief` (shall) answer 404 without any GitHub call, DB write or model call.
  *Verify:* route test with spies on the GitHub client, the brief repository write and the LLM asserts zero calls.
- **AC-58 (P1, G4).** ЯКЩО the PR belongs to a workspace the caller is not a member of, ТОДІ POST `/pulls/:id/brief` (shall) answer 403, and the authorization check (shall) run before any GitHub call, DB write, rate-limiter admission or model call.
  *Verify:* route test with spies asserts 403 and zero GitHub/DB-write/LLM calls; an immediate POST by an authorized member is not rate-limited by the rejected request.

Diff model

- **AC-59 (P2, G6).** ЯКЩО the PR diff loads successfully with zero files, ТОДІ the system (shall) treat the diff as loaded: show an empty diff-stats section, keep `diff` out of `missing`, and return an empty Review focus list.
  *Verify:* route test with a diff loader returning a loaded result with zero files asserts `missing` excludes `diff`, `diff_stats.files = 0` and `review_focus: []`.
- **AC-60 (P2, G2).** The system (shall) exclude deleted, pure-rename and binary files from the diff facts, so any model reference to such a file is dropped by grounding like any other path outside the allow-list.
  *Verify:* service test with a model output citing a deleted file and a binary file (absent from diff facts) asserts both refs are dropped and counted in `grounding`.
- **AC-61 (P2, G2).** ЯКЩО a file was renamed and also has changed hunks, ТОДІ the system (shall) ground references to it by its new path only; a reference using the old path (shall) be dropped.
  *Verify:* service test with a rename-with-hunks fixture asserts the new path survives and the old path is dropped.

Grounding and path safety

- **AC-62 (P1, G2).** The system (shall) store each grounded file reference as the canonical allow-list path (the exact string from the diff facts or blast map), never the model's string, even when the match was made after trimming a leading `./`.
  *Verify:* service test where the model returns `./src/a.ts` asserts the stored value is `src/a.ts`.
- **AC-63 (P2, G2).** The system (shall) reject any path (from the model, the diff or the blast map) that contains a NUL character, is absolute (leading `/`, `\` or a drive letter), or contains a `..` segment, before prompt construction, grounding and navigation.
  *Verify:* unit test of the path validator with each case; service test asserts such a model path is dropped and such a diff/blast path is not sent to the model.

Budget and input safety

- **AC-64 (P2, G3).** ЯКЩО the never-truncated content alone (framing plus protected sections, after all truncatable sections are cut to their minimum) exceeds 8,000 estimated tokens, ТОДІ the system (shall) make no model call, answer a 502-class error `{error, retry_after}`, keep the previous brief unchanged, and log `outcome=input_over_budget`; it (shall) not surface an unhandled exception.
  *Verify:* route test that injects a lower token budget (below the size of the never-truncated content of an ordinary fixture) asserts 502, zero LLM calls, an unchanged row and the log outcome. It does not rely on an oversize Intent summary, which is capped at ingest.
- **AC-65 (P2, G3).** The system (shall) escape or encode every untrusted text placed inside a delimited data block so that it cannot contain a literal closing delimiter or source-tag sequence.
  *Verify:* builder unit test asserts the escaped form of delimiter characters inside blocks and that block boundaries parse to the expected source labels.
- **AC-66 (P2, G3).** ЯКЩО untrusted text (PR description, issue body, spec content or a file path) contains a fake closing delimiter, a fake source tag or an instruction such as "ignore previous instructions", ТОДІ the serialized input (shall) still contain exactly the expected set of data blocks with their original source labels, and the injected text (shall) appear only inside its own block.
  *Verify:* adversarial builder test with fake `</untrusted>` and `<untrusted source="system">` strings in each untrusted field asserts the block count, labels and containment.
- **AC-67 (P2, G3).** ЯКЩО the provider call fails, ТОДІ the system (shall) log only a sanitized error class and a sanitized message (no raw provider error body, prompt content, document content or credentials).
  *Verify:* route test with a stub error whose message contains a prompt sentinel and a fake API key asserts neither appears in the log line or the 502 body.

Contract

- **AC-68 (P2, G3).** The system (shall) validate the complete post-grounding `PrBrief` against the brief stored schema before storing it; ЯКЩО validation fails, ТОДІ it (shall) answer 502 and keep the previous brief unchanged.
  *Verify:* service test that forces an invalid post-grounding object (for example via a bad clamp fixture) asserts no write and 502.
- **AC-69 (P2, G2).** The system (shall) set `line_adjusted` only during grounding; the field (shall) be absent from the model output schema.
  *Verify:* schema test asserts the model output schema has no `line_adjusted`; service test asserts a model-supplied `line_adjusted: true` on an in-range line is not stored.
- **AC-70 (P2, G3).** The system (shall) store `meta.tokens_in`, `meta.tokens_out` and `meta.cost_usd` as nullable, and set them to null when the provider did not report them. Because the LLM adapters coerce missing usage to 0, a reported value of 0 (shall) be treated as not reported and stored as null.
  *Verify:* service test with a stub returning no usage, and one returning usage of 0, asserts nulls in `meta` and a schema parse success; a stub returning non-zero usage asserts the numbers are stored.
- **AC-71 (P2, G4).** The system (shall) record `meta.generated_at` as an ISO-8601 UTC timestamp (suffix `Z`) taken from the server clock at storage time.
  *Verify:* contract test rejects a non-UTC or non-ISO value; service test with a fixed clock asserts the exact string.

Rate limit

- **AC-72 (P2, G4).** КОЛИ the system answers 429, `retry_after` in the body (shall) be the remaining cooldown in whole seconds rounded up (ceil, minimum 1), and the `Retry-After` header (shall) carry the same value.
  *Verify:* route test with a fake clock at 29.2 s remaining asserts `retry_after = 30` and `Retry-After: 30`; at 0.1 s remaining asserts 1.

Navigation and accessibility

- **AC-73 (P3, G5).** The system (shall) render a risk's expand control and its navigate-to-file control(s) as separate controls: activating expand never navigates, and activating navigate never toggles expansion.
  *Verify:* component test activates each control by keyboard and click and asserts only its own effect.
- **AC-74 (P2, G5).** КОЛИ Files changed scrolls to a deep-linked file or line (AC-38, AC-39), the system (shall) not move keyboard focus.
  *Verify:* DiffTab test asserts `document.activeElement` is unchanged after the scroll.
- **AC-75 (P2, G5).** ПОКИ the user prefers reduced motion, the system (shall) scroll to a deep-linked target without smooth animation.
  *Verify:* DiffTab test with a mocked `prefers-reduced-motion: reduce` asserts the instant scroll behavior; without it, smooth.
- **AC-76 (P2, G5).** КОЛИ the system navigates from the brief to Files changed, it (shall) replace the current history entry (`router.replace`), so the browser Back action does not return to the Overview tab.
  *Verify:* component test asserts `router.replace` (not `push`); e2e asserts Back leaves the PR page state rather than returning to `tab=overview`.
- **AC-83 (P3, G5).** КОЛИ the `file` URL parameter changes to a path that is not in the PR's diff, the system (shall) show the toast "File not in this PR's diff", and it (shall) show it again on each later change to a different unknown path.
  *Verify:* DiffTab test changes the param from unknown A to unknown B and asserts two toasts; re-rendering with the same unknown A shows no extra toast.

Freshness

- **AC-77 (P2, G4).** КОЛИ a POST generation succeeds, the response `stale` flag (shall) be computed by comparing the stored `generated_from_head_sha` with the PR's head SHA re-read after generation; ЯКЩО the head moved during generation, ТОДІ the response (shall) have `stale: true`.
  *Verify:* route test updates `head_sha` from inside the LLM stub and asserts the POST response has `stale: true` and the stored SHA is the pre-generation one.

Decisions turned into ACs

- **AC-78 (P3, G1).** ПОКИ a brief is shown and the live Intent or Blast radius differs from the snapshot stored in the brief, the system (shall) show the advisory hint "Inputs changed since this brief — Regenerate" (decision D-2). The comparison covers Intent presence, summary and scope items, and Blast presence, summary and the set of caller files, ignoring order.
  *Verify:* component test: snapshot `intent: null` with live Intent present shows the hint; identical data in a different caller order shows no hint.
- **AC-79 (P2, G3).** The system (shall) restrict `kind` in the model output schema to `security | db_migration | breaking_api | perf | deps | correctness | other`, while the shared `Risk.kind` contract stays a free string (decision D-4).
  *Verify:* schema test rejects an unknown kind in model output; contract test accepts an arbitrary string in the shared `Risk`.
- **AC-80 (P3, G1).** ЯКЩО a risk's `kind` is not one of the known kinds, ТОДІ the system (shall) render it with a generic icon and its text label.
  *Verify:* component test with `kind: 'custom'`.
- **AC-81 (P2, G3).** ЯКЩО the provider configured in the `risk_brief` setting is unusable (for example its API key is missing), ТОДІ the system (shall) make no model call with any other provider, answer 502 with a message naming the Risk Brief model setting, keep the previous brief, and log `outcome=provider_unavailable` (decision D-5).
  *Verify:* route test with no key for the configured provider asserts 502, the message text, zero LLM calls and an unchanged row.
- **AC-82 (P2, G3).** ЯКЩО the model call does not complete within 50 s, ТОДІ the system (shall) answer 502 `{error, retry_after}`, keep the previous brief, and log `outcome=timeout` (decision D-6).
  *Verify:* service test with fake timers asserts 502, no write and the log outcome.
- **AC-84 (P2, G3).** The system (shall) leave the shared `Risk` schema unchanged (no `min(1)` on `file_refs`); the "at least one file reference" guarantee for brief risks (shall) be enforced by grounding (AC-14) and by the brief-specific stored schema used in AC-68. (Amended by D-15 / AC-85: the shared `Risk` schema gains exactly one optional field, `anchor`; no existing field is tightened.)
  *Verify:* contract test: shared `Risk` parses `file_refs: []`; brief stored schema rejects a risk with `file_refs: []`.

### Added in revision 4 (AC-85 and up)

Risk line range (anchor): contract and model output

- **AC-85 (P2, G2).** The shared `Risk` schema (shall) have exactly one new field, optional `anchor: { file: string, start_line: integer ≥ 1, end_line: integer ≥ start_line }`, and every existing `Risk` field (shall) keep its current definition, so a `Risk` without `anchor` still parses (D-15).
  *Verify:* contract test: a `Risk` without `anchor` parses; `anchor {file:'a.ts', start_line:12, end_line:18}` parses; `start_line: 0`, `end_line < start_line`, and a non-integer line are rejected; `file_refs: []` and an arbitrary `kind` still parse (AC-79, AC-84).
- **AC-86 (P2, G3).** The system (shall) require in the model output schema, per risk, the keys `anchor_file` (string or null), `anchor_start_line` (integer or null) and `anchor_end_line` (integer or null), all required and nullable (no optional keys), with no `anchor` key; `anchor` in the stored brief (shall) be built only by code from these values (D-16).
  *Verify:* schema test asserts the three keys are required and accept null; a model output that omits one of them fails the output schema (AC-23); a model output carrying an `anchor` object does not produce a stored `anchor` from that object.
- **AC-87 (P2, G3).** The system (shall) state in the model instructions that the anchor is optional (all three anchor values null when no specific lines apply), that it must name one of the risk's own file refs, and that its lines must refer to new-side lines in the changed files of this PR only.
  *Verify:* builder unit test asserts the instruction text is present in the system message; the AC-19 worst-case budget test still passes with it.

Risk line range (anchor): grounding

- **AC-88 (P2, G2).** ЯКЩО a risk's `anchor_file` does not match, by the same canonical matching as file references (AC-62, AC-63), one of that risk's file references that survived grounding, ТОДІ the system (shall) store the risk without `anchor`.
  *Verify:* service test: a risk with refs `[src/a.ts]` and `anchor_file: 'src/b.ts'` (itself a valid diff file) is stored with refs `[src/a.ts]` and no anchor; with `anchor_file: './src/a.ts'` the stored `anchor.file` is the canonical `src/a.ts`.
- **AC-89 (P2, G2).** ЯКЩО the anchor file is not a path in the PR diff facts (for example a blast-only caller file, or any file when the diff is unavailable, AC-48), ТОДІ the system (shall) store the risk without `anchor`. A risk whose surviving file refs are only blast caller files therefore never has an anchor.
  *Verify:* service test: a risk whose only ref is a blast caller and whose anchor names that caller is stored with the ref and no anchor; a route test with a throwing diff loader asserts no stored risk has an anchor.
- **AC-90 (P2, G2).** ЯКЩО a risk's anchor values are partial (some but not all three null), or `anchor_start_line` < 1, or `anchor_end_line` < `anchor_start_line`, ТОДІ the system (shall) store the risk without `anchor`, keeping its file references.
  *Verify:* service test with each case asserts the risk is kept with its refs and has no anchor.
- **AC-91 (P2, G2).** КОЛИ a risk's anchor range [start, end] intersects at least one hunk new-side line range of the anchor file (context lines included, D-9), the system (shall) store `anchor` with `start_line` = the lowest line in [start, end] covered by some hunk range and `end_line` = the highest such line (D-17).
  *Verify:* service test with hunk ranges `[10-20, 50-60]`: anchor 12-18 stored 12-18; 5-12 stored 10-12; 18-30 stored 18-20; 25-55 stored 50-55; 15-55 stored 15-55; 12-12 stored 12-12.
- **AC-92 (P2, G2).** ЯКЩО a risk's anchor range intersects no hunk new-side line range of the anchor file, ТОДІ the system (shall) drop the anchor and still store the risk with its grounded file references.
  *Verify:* service test with hunk ranges `[10-20, 50-60]` and anchor 21-49 (and anchor 70-80) asserts the risk is stored with its refs and without `anchor`.
- **AC-93 (P2, G2).** The system (shall) count in `meta.grounding.dropped_anchors` every stored risk for which the model supplied at least one non-null anchor value but no `anchor` was stored (AC-88..AC-90, AC-92), and return it in the response metadata. A risk with all three anchor values null (shall) not be counted, and a risk dropped by AC-14 (shall) not be counted (it is counted in `dropped_risks`) (D-18).
  *Verify:* service test with one valid anchor, one out-of-hunk anchor, one partial anchor, one all-null anchor and one risk dropped for invented refs asserts `dropped_anchors = 2` and `dropped_risks = 1`.
- **AC-94 (P2, G3).** КОЛИ grounding ran, the generation log line (shall) include `dropped_anchors=<n>` next to the other grounding drop counts (AC-26).
  *Verify:* route test captures the log line and asserts `dropped_anchors=` with the expected count.

Risk line range (anchor): contract and compatibility

- **AC-95 (P2, G3).** The `PrBrief.meta.grounding` contract (shall) have a new optional number field `dropped_anchors` that reads as 0 when absent; all other `meta` fields listed in AC-24 (shall) keep their definitions.
  *Verify:* contract test: `grounding` without `dropped_anchors` parses and yields 0; with `dropped_anchors: 3` parses and yields 3.
- **AC-96 (P2, G3).** The server and client copies of the brief contract (shall) stay identical, including `Risk.anchor` and `grounding.dropped_anchors` (cross-reference AC-24).
  *Verify:* diff check between the two `brief.ts` copies, or one fixture with an anchored risk and `dropped_anchors` parsed by both copies with equal results; typecheck in both packages.
- **AC-97 (P2, G4).** КОЛИ GET `/pulls/:id/brief` reads a brief stored before this revision (risks without `anchor`, `grounding` without `dropped_anchors`), the system (shall) return it as a valid brief (not the "no brief" path) and the card (shall) render it with plain file labels.
  *Verify:* route test seeds a pre-revision JSON row and asserts 200 with the brief; component test renders it with no line suffix on any risk label.
- **AC-98 (P2, G2).** The brief stored schema used in AC-68 (shall) reject a risk whose `anchor.file` is not one of that risk's `file_refs`.
  *Verify:* stored-schema test rejects `{file_refs:['a.ts'], anchor:{file:'b.ts', start_line:1, end_line:2}}` and accepts the same risk with `anchor.file: 'a.ts'`.

Risk line range (anchor): UI

- **AC-99 (P2, G1).** The system (shall) show the risk header file label as `file:start-end` when the risk has an anchor with `start_line` ≠ `end_line`, as `file:line` when `start_line` = `end_line`, using the anchor file; ДЕ the risk has no anchor, it (shall) show the plain first file reference as today (AC-8).
  *Verify:* component test with anchors 12-18 and 12-12 and a risk without anchor asserts the labels `src/middleware/ratelimit.ts:12-18`, `src/middleware/ratelimit.ts:12` and the plain path.
- **AC-100 (P3, G5).** КОЛИ the reviewer activates the navigate control of a risk's anchor file and that file is in the PR's current diff, the system (shall) navigate to Files changed with `?tab=diff&file=<url-encoded anchor file>&line=<anchor start_line>` by the rules of AC-35, AC-36 and AC-76; navigation to a non-anchor file ref of the same risk (shall) keep the existing behavior (AC-42), and a file not in the current diff (shall) show the toast (AC-41).
  *Verify:* component test asserts the `router.replace` argument contains `line=12` for anchor 12-18; a non-anchor ref of the same risk produces no `line=` from the anchor; an anchor file absent from the current diff shows the toast and no navigation.

Cost and tokens in the brief header

- **AC-101 (P2, G3).** ПОКИ a brief is shown and `meta.cost_usd` is not null, the system (shall) show the cost in the card header as `$` followed by the value rounded to 3 decimals (for example `$0.014`), or as `<$0.001` when the value is positive and below 0.001 (D-20).
  *Verify:* component test: 0.0142 shows `$0.014`; 1.2 shows `$1.200`; 0.0004 shows `<$0.001`.
- **AC-102 (P2, G3).** ПОКИ a brief is shown and both `meta.tokens_in` and `meta.tokens_out` are not null, the system (shall) show the tokens in the card header as `<in>→<out>`, where each count from 1,000 up is shown in thousands rounded to one decimal with a `K` suffix and each count below 1,000 as a plain integer (for example `8.2K→1.3K`, `950→120`).
  *Verify:* component test: 8,150/1,312 shows `8.2K→1.3K`; 1,000/999 shows `1.0K→999`; 950/120 shows `950→120`.
- **AC-103 (P2, G3).** ЯКЩО any of `meta.cost_usd`, `meta.tokens_in`, `meta.tokens_out` is null, ТОДІ the system (shall) omit that part from the header line; when exactly one token count is null, the present count (shall) be shown alone with its direction word from `brief.json` (for example `8.2K in` or `1.3K out`) and no arrow.
  *Verify:* component test with cost null shows only the tokens; with `tokens_out` null shows `$0.014  8.2K in`; with `tokens_in` null shows `1.3K out`.
- **AC-104 (P2, G3).** ЯКЩО `meta.cost_usd`, `meta.tokens_in` and `meta.tokens_out` are all null, ТОДІ the system (shall) not render the cost-and-tokens line at all (no empty element, no placeholder).
  *Verify:* component test with all three null asserts no element with the cost-and-tokens accessible name exists.
- **AC-105 (P2, G3).** The cost-and-tokens line (shall) have an accessible name and a `title` that spell out the meaning and the exact values of the shown parts (for example "Generation cost and tokens: cost $0.014, input tokens 8,150, output tokens 1,312"), omitting null parts.
  *Verify:* component test asserts the accessible name and `title` text for a full fixture and for a fixture with `tokens_out` null.
- **AC-106 (P2, G3).** The system (shall) take the label, `title`/accessible-name templates and the `in`/`out` direction words of the cost-and-tokens line from `brief.json` keys under `card.costTokens*` (for example `card.costTokens`), with no hard-coded English (AC-54).
  *Verify:* grep for hard-coded English in the header component; the i18n test passes with the new keys present in `client/messages/en/brief.json`.
- **AC-107 (P2, G3).** ПОКИ the shown brief is stale or a regeneration is in flight, the system (shall) keep showing that brief's cost-and-tokens line with the same values (dimmed together with the brief during regeneration, AC-53), and (shall) replace it only when a new brief replaces the shown one.
  *Verify:* component test with `stale: true` asserts the line is present; with a pending regeneration asserts the old values remain until the POST resolves, then the new values show.

## Edge cases

| Case | Expected behavior | AC |
|---|---|---|
| No Intent, no blast index (test PR) | Brief generates. `missing` = `intent, blast`. The note is shown. One `completeStructured` call. | AC-7, AC-43, AC-44 |
| Empty PR description and no linked issue | Generates. `description` and `linked_issue` are in `missing`, in canonical order. The summary relies on file stats. | AC-45 |
| Huge PR (1,000+ files) | Diff-stats rows are capped. Lower-priority roles (docs, boilerplate, tests) and the lowest-churn files are cut first and replaced by a "+N more files (+A/−D)" line. The budget holds on the exact serialized messages. | AC-19, AC-21 |
| Giant description, issue or spec | Truncated in budget order with a marker. Recorded in `input.truncated`. | AC-21, AC-22 |
| Never-truncated content alone exceeds the budget | No model call. 502-class error, `outcome=input_over_budget`, old brief kept. Counts toward the cooldown. | AC-64, AC-31 |
| Model invents a path, or returns a path with a different case or a `./` prefix | Matching is exact on repo-relative paths after trimming a leading `./`; the stored value is the canonical allow-list path. Anything that does not match is dropped. | AC-13–AC-15, AC-62 |
| Path with NUL, absolute form or `..` segment | Rejected before prompt construction, grounding and navigation. | AC-63 |
| Model returns a focus line outside any hunk range | The line is snapped to the nearest hunk range start and flagged as adjusted. A line on a context line inside a hunk range is kept (D-9). | AC-16 |
| Model cites a deleted, pure-rename or binary file | The diff loader dropped these files, so the reference is outside the allow-list and is dropped by grounding. | AC-60 |
| Renamed file that also has changed hunks | Grounded by the new path only; the old path is dropped. | AC-61 |
| Diff cannot be loaded | `diff` in `missing`; grounding against blast callers only; Review focus empty; no risk has an anchor. | AC-48, AC-89 |
| Diff loads with zero files | Not an error: empty diff-stats section, `diff` not in `missing`, Review focus empty. | AC-59 |
| All risks dropped by grounding | `noRisks` label shown. The drop counts are returned and logged. | AC-11, AC-17 |
| Risk anchor names a file that is not one of the risk's refs | Anchor dropped and counted; the risk is kept with its refs. | AC-88, AC-93 |
| Risk anchor on a blast-only caller file | Anchor dropped and counted; the risk is kept with its refs; the header shows the plain file. | AC-89, AC-93, AC-99 |
| Risk anchor range partly outside the hunks | Clipped to the hunk-covered span of the intersection; not counted as dropped. | AC-91 |
| Risk anchor range entirely between or outside hunks, start > end, start < 1, or partial nulls | Anchor dropped and counted; the risk is kept. | AC-90, AC-92, AC-93 |
| Anchor file no longer in the diff after a later commit | Navigate shows the toast; the label still shows the stored range. | AC-41, AC-100 |
| Brief stored before revision 4 | Parses; risks show plain file labels; `dropped_anchors` reads as 0. | AC-95, AC-97 |
| Provider reports no usage (cost and tokens null) | The cost-and-tokens line is not rendered. | AC-70, AC-104 |
| Only one token count reported | The present count is shown with its `in`/`out` word, no arrow. | AC-103 |
| Very small cost | Shown as `<$0.001`. | AC-101 |
| New commit pushed after generation | The brief is shown with a stale badge (computed on each GET). Focus items pointing at files no longer in the diff produce the toast. | AC-29, AC-41 |
| New commit pushed during generation | The brief is stored with the SHA its inputs were gathered at; the POST response has `stale: true`. | AC-27, AC-77 |
| Two tabs or users click Generate at once (same process) | The first request is admitted. The second gets 429, refetches GET once, and says generation was recently started; it does not claim a brief exists. | AC-31, AC-32 |
| Overlapping generations on different server processes | Both may run; the last successful write wins. No compare-and-swap (accepted). | AC-27 |
| Server restart during cooldown | The limiter resets (in-memory, like Intent). Accepted. | AC-31 |
| LLM provider key missing for the `risk_brief` provider | 502 whose message names the Risk Brief model setting. No fallback model. The old brief is kept. Counts toward the cooldown. | AC-81, AC-31 |
| Model call exceeds 50 s | 502, `outcome=timeout`, old brief kept. A late provider response may still be billed (accepted). | AC-82 |
| Provider error text echoes the prompt or a key | Only a sanitized error class and message are logged; the 502 body carries no raw provider text. | AC-67 |
| Untrusted text contains fake delimiters or instructions | Escaped; it stays inside its own data block and cannot add blocks or change labels. | AC-65, AC-66 |
| Stored JSON from an older contract version, or unparsable | GET treats it as "no brief" (404 / empty state) and logs a warning. It is overwritten on the next generation. Rows from before revision 4 are not "older" in this sense: they parse (AC-97). | AC-1, AC-97 |
| URL `file` param names a path not in the PR | Files changed opens normally and shows "File not in this PR's diff"; the toast fires again on each change to a different unknown path. | AC-83 |
| Live Intent derived after the brief was generated | Advisory hint "Inputs changed since this brief — Regenerate". | AC-78 |
| Unknown risk kind in stored data | Generic icon with the text label. | AC-80 |
| PR closed or merged | Generation is still allowed. The brief is read-only information. | n/a |

## Non-functional requirements

- **Performance.** GET `/pulls/:id/brief` reads the DB only (no GitHub, no model, no diff load), with p95 ≤ 300 ms locally. POST targets ≤ 60 s end to end (decision D-6); the model call is capped at 50 s (AC-82), leaving the remainder for input gathering, grounding and storage. Model output is capped by the schema limits: summary ≤ 600 chars, ≤ 8 risks, explanation ≤ 400 chars, ≤ 7 focus items, reason ≤ 200 chars.
- **Cost.** One `completeStructured` call per generation, `maxRetries: 1` (at most 2 schema attempts, so at most 2 billed requests from schema reprompts; adapter transport retries are not counted and are not bounded by this spec). Input ≤ 8,000 estimated tokens on the exact serialized messages. Cost (`cost_usd`, nullable) is stored with the brief and logged, and shown in the card header with the token usage (AC-101..AC-107).
- **Security.** Authorization runs before any GitHub call, DB write, limiter admission or model call (AC-58). Untrusted text is escaped inside delimited data blocks (AC-65, AC-66). Paths with NUL, absolute form or `..` segments are rejected (AC-63); stored paths are canonical allow-list paths (AC-62), including anchor files (AC-88). Model output is rendered as plain text, or through the existing `Markdown` component that never renders raw HTML. No document content from RefResolver is persisted. No secrets go into prompts or logs; provider errors are logged sanitized (AC-67).
- **Accessibility.** Generate and Regenerate are real buttons with accessible names. Focus items and risk navigate controls are keyboard-focusable buttons whose names include the file and line. The risk expand control is a separate chevron button with `aria-expanded`, `aria-controls` and an accessible name (AC-51, AC-73). Deep-link scrolling does not move focus and respects reduced motion (AC-74, AC-75). The stale badge, missing-data note, inputs-changed hint, rate-limit and error messages use `role="status"` / `role="alert"`. Severity is not conveyed by color alone (text or icon label too). The cost-and-tokens line has a spelled-out accessible name and `title`, so the `K` abbreviation and the arrow are not the only carriers of meaning (AC-105).
- **Observability.** One structured log line per generation, success or failure (AC-26), in the same style as the Intent `llm.calls` line, with `brief=0|1`, `schema_attempts`, an outcome and, when grounding ran, `dropped_anchors` (AC-94). 429 is logged with the PR id and the `brief` step.
- **Compatibility.** Both copies of the `brief.ts` contract change in lockstep (AC-96). The shared `Risk` schema is not tightened (AC-84); it is extended only with the optional `anchor` field (AC-85), so all existing consumers and stored rows still parse (AC-97). `grounding.dropped_anchors` is optional with a default of 0 (AC-95). Existing Intent and Blast routes and UI behavior are unchanged.

## Inputs and provenance

| Input | Provenance | Notes |
|---|---|---|
| Intent (summary, in/out scope) | [reused: L03 `pr_intent` via `IntentRepository.getIntent` in `server/src/modules/intent/repository.ts`] | Read only, never derived here. The assignment names `reviews/repository.ts`, but `getIntent` actually lives in `intent/repository.ts`. |
| Blast radius summary + caller files | [reused: L04 `repoIntel.getBlastRadius` + `buildBlastRadius`, same data as GET `/pulls/:id/blast`] | Only `summary` and caller `file:line` go to the model. Not cached per PR. Computed at generation time. |
| Changed files, +/− counts, hunk new-side line ranges (context included, D-9), load status (`loaded` / `unavailable`) | [deterministic: `reviews/diff-loader` `loadDiff`, as Intent uses] | `pr_files` may be empty until PR detail is opened, so the diff loader is the source. Deleted, pure-rename and binary files are excluded from the diff facts by the brief: the git path drops them in the parser, while the `pr_files` fallback keeps deleted files, so the diff facts filter out any file with no new-side hunk (AC-60). No change status is derived. Hunk bodies are never forwarded. The same hunk ranges validate and clip risk anchors (AC-91). |
| Smart Diff role per file | [deterministic: `reviews/smart-diff/classify`] | Path rules, no model. The only per-file classification sent or shown. |
| PR title, description | [reused: `pull_requests` row] | Untrusted. |
| Linked issue | [deterministic: RefResolver `extractIssueRef` + GitHub fetch] | Resolved live. Only the code-owned label ("Linked issue #<number>" or "Issue #<number> (other repository)") and status are persisted (D-12). Untrusted. |
| Referenced spec/plan docs | [deterministic: RefResolver, `intent/ref-resolver.ts`, ≤ 32 KB per doc before budget] | Resolved live. Only the code-owned label ("Spec at <repo-relative path>" or "Plan at <repo-relative path>") and status are persisted (D-12). Untrusted. |
| Missing-data list (canonical order), input estimate, truncation list | [deterministic: brief input builder] | |
| Delimiter escaping | [deterministic: brief input builder] | |
| Path validation (NUL, absolute, `..`) | [deterministic: brief path validator] | |
| Grounding (path allow-list, canonical paths, line snapping, `line_adjusted`) | [deterministic: brief service] | Code owns path validity, not the model. |
| Anchor grounding (tie to risk refs and diff files, hunk clipping, `dropped_anchors`) | [deterministic: brief service] | Builds `Risk.anchor` from the nullable `anchor_*` model values; the model never sees hunk bodies, so every anchor line is validated against hunk ranges by code and unvalidated anchors are dropped (AC-88..AC-93). |
| Post-grounding validation | [deterministic: brief stored schema] | Includes the `anchor.file ∈ file_refs` rule (AC-98). |
| Stale flag | [deterministic: stored SHA vs `pull_requests.head_sha` re-read when building each response] | |
| Inputs-changed hint | [deterministic: client comparison of stored snapshot vs live Intent/Blast] | |
| Cost-and-tokens header line | [reused: stored `meta.cost_usd`, `meta.tokens_in`, `meta.tokens_out` (AC-70)] + [deterministic: client formatting] | Nothing new is stored (D-20). |
| Model selection | [reused: `resolveFeatureModel(container, workspaceId, 'risk_brief')`] | Default `openai` / `gpt-4.1` (`contracts/platform.ts`). No fallback. |
| Verdict + score (P3 banner) | [reused: latest review runs] | Not produced by the brief. |
| Summary, risks (kind, title, explanation, severity, file_refs, `anchor_file`, `anchor_start_line`, `anchor_end_line`), review_focus (file, line, reason) | [new: 1 LLM call, `completeStructured` with `risk_brief` model, `maxRetries: 1`] | The model summarizes and prioritizes. Every path and line, including anchors, is then validated by code. No extra call is added by revision 4. |

### Input budget

- **Unit.** Estimated tokens = ceil(characters / 4) over the exact serialized system and user messages, including instructions, output schema, injection guard, delimiters, source labels, truncation markers and escaping. The provider-reported `tokens_in` is logged for comparison.
- **Total.** ≤ 8,000 estimated tokens: about 1,500 reserved for framing, about 6,500 shared by the variable sections.

Each variable section has a ceiling, measured on its escaped content. When content exceeds a ceiling, the section is cut. A section never borrows budget another section left unused. After assembly the builder measures the exact serialized messages; if the total still exceeds 8,000 (for example because framing outgrew its reserve), it keeps cutting truncatable sections in the same order until the total fits. If it cannot fit with every truncatable section at its minimum, generation fails before the call with `input_over_budget` (AC-64). The "Truncation order" column ranks sections from first to be cut (1) to last (5).

| Section | Ceiling (est. tokens) | Truncation order |
|---|---|---|
| Framing: instructions, output schema, injection guard, delimiters and source labels, truncation markers, missing-data list, PR title | ≈ 1,500 (reserved) | Never |
| Intent summary | ≤ 300 | Never |
| Intent in/out scope lists | ≤ 400 | Fixed cap of 8 items per list. Not part of the order. |
| Blast summary line | ≤ 100 | Never |
| Spec/plan docs | ≤ 800 | 1st: head kept + marker, then the doc is dropped |
| Linked issue title + body | ≤ 700 | 2nd: title kept, body head kept + marker |
| PR description | ≤ 1,200 | 3rd: head kept + marker |
| Blast caller list (≤ 25 distinct `file:line`) | ≤ 500 | 4th: lowest-ranked callers dropped |
| Diff stats rows (path, Smart Diff role, +a/−d, hunk new-side line ranges) | ≤ 2,500 | 5th: rows dropped by role (docs → boilerplate → tests → wiring → core), then by lowest churn, and replaced by an aggregate "+N more files" line |

Variable ceilings sum to 6,500; with the 1,500 framing reserve the total is 8,000. The anchor instruction (AC-87) and the three `anchor_*` keys of the output schema (AC-86) are part of the framing.

## Untrusted inputs

All of the following come from the repo, the PR or GitHub, and are fed to the model:

- PR title and description
- Linked issue title and body
- Referenced spec/plan document contents
- File paths, which are attacker-controllable names
- Blast caller file paths and symbol names
- The Intent summary and scope items, which are model-derived from the same untrusted sources

They are passed as clearly delimited data blocks (tagged sections with their source labels), after an explicit injection guard in the system message: content inside those blocks is data, may contain instructions, and must not change the task, the output schema or any policy. Text inside a block is escaped or encoded so it cannot contain a literal closing delimiter or a fake source tag (AC-65); an adversarial test proves that injected text stays in its own block (AC-66). Paths with NUL, absolute form or `..` segments are rejected before they reach the prompt (AC-63). Untrusted text cannot change policy. In particular it cannot add paths or lines: grounding (AC-13–AC-16, AC-60–AC-62) removes any file not in the PR diff facts or blast map and stores only canonical paths, anchor grounding (AC-88–AC-92) keeps an anchor only on one of the risk's grounded diff files and only inside its hunk ranges, and the output is validated before grounding (AC-23) and after it (AC-68, AC-98). Model output is rendered as text, with no raw HTML. Prompt bodies and RefResolver content are not traced or logged locally (D-14). Revision 4 adds no new untrusted text to the model input.

## Decisions

The user accepted the proposed defaults for OQ-1..OQ-6 and OQ-7..OQ-12. They are decisions, not open questions.

- **D-1 (was OQ-1). Review focus scope.** Focus items may only point at PR diff files (AC-15). Risks may also cite blast caller files (AC-13); navigating to a blast-only file shows the toast (AC-41).
- **D-2 (was OQ-2). Intent and Blast in the card.** The card renders the live IntentBlock and BlastRadiusBlock, which keep their own actions such as Run Intent; the separate Overview blocks are moved into the card, not duplicated (AC-5, AC-6). The brief JSON stores the trimmed snapshot the model saw (`intent`, `blast` = summary + caller files). If live data differs from the snapshot, the card shows the advisory hint "Inputs changed since this brief — Regenerate" (AC-78).
- **D-3 (was OQ-3). Contract shape.** `intent` and `blast` are nullable, `history` is optional, and `summary`, `review_focus` and `meta` are added (AC-24). Usage and cost fields are nullable (AC-70), `generated_at` is ISO-8601 UTC (AC-71), `missing` has a canonical order (AC-45), `line_adjusted` is grounding-only (AC-69), and the full brief is validated after grounding (AC-68).
- **D-4 (was OQ-4). Risk kinds.** The model output schema restricts `kind` to `security | db_migration | breaking_api | perf | deps | correctness | other` (AC-79). The shared `Risk.kind` stays a free string and the shared `Risk` schema is not tightened (AC-84). The UI shows a generic icon for unknown kinds (AC-80). (Amended by D-15: the shared `Risk` schema is extended with one optional `anchor` field.)
- **D-5 (was OQ-5). Model fallback.** None. A 502 names the `risk_brief` setting (AC-81).
- **D-6 (was OQ-6). Generation time.** POST targets ≤ 60 s end to end; the model call is capped at 50 s (AC-82).
- **D-7. One-call wording.** `maxRetries: 1` is kept; one generation = one `completeStructured` call with up to 2 schema attempts (G3, AC-18).
- **D-8. Diff loader scope.** Excluding deleted, pure-rename and binary files from the diff facts is accepted (AC-60); the diff loader and parser are not changed.
- **D-9 (was OQ-7). Navigable line ranges.** The navigable ranges are the hunk new-side ranges, context lines included. A focus line inside any hunk range of its file is kept; a line outside every hunk range is snapped (AC-16). The same hunk ranges are what the diff facts send to the model (AC-20).
- **D-10 (was OQ-8). Degraded brief replaces a complete one.** A brief generated with `diff` or `blast` missing replaces a complete prior brief; the last successful write wins (AC-27). The missing-data note makes the degradation visible (AC-7, AC-45).
- **D-11 (was OQ-9). Healthy index with no callers.** A healthy repo-intel index that reports zero callers means Blast radius is available with no callers; `blast` is not added to `missing`. Only a degraded index makes Blast missing (AC-44).
- **D-12 (was OQ-10). Source labels.** Stored source labels are code-owned strings: "PR title", "PR body", "Changed files", and for resolved references "Linked issue #<number>", "Spec at <repo-relative path>", "Plan at <repo-relative path>" and "Issue #<number> (other repository)". Each is stored with its status (`fetched` / `unavailable` / `error`). No contents, titles or URLs are stored (AC-46).
- **D-13 (was OQ-11). Absent vs failed sources in the note.** The missing-data note lists absent and failed sources alike under "Generated without"; the source chips (AC-55) show the difference through their status (AC-46, AC-47).
- **D-14 (was OQ-12). Retention of prompt and RefResolver content.** No local tracing or logging of prompt bodies or RefResolver content (consistent with AC-46 and AC-67). Provider-side retention follows the workspace's provider settings and is not controlled by this feature.
- **D-15. Risk anchor contract (amends D-4 and AC-84).** The shared `Risk` schema gets exactly one new optional field, `anchor?: { file: string, start_line: int ≥ 1, end_line: int ≥ start_line }`, applied identically in both `brief.ts` copies. It is backward compatible: all existing consumers and stored rows still parse. `Risk` is extended, not tightened; `kind` stays a free string and `file_refs` gets no `min(1)` (AC-85, AC-96, AC-97).
- **D-16. Model output shape for anchors.** The model output schema is strict with no optional keys, so each risk carries required nullable `anchor_file: string | null`, `anchor_start_line: integer | null`, `anchor_end_line: integer | null`. Code builds `anchor` from them; the model never emits `anchor` directly. The prompt states that the anchor is optional and must refer to lines in the changed files only (AC-86, AC-87).
- **D-17. Anchor grounding.** The anchor file must canonically match one of the risk's grounded file refs and be a PR diff file. The range is validated against that file's hunk new-side ranges (context included, D-9): if it intersects at least one hunk range it is kept, clipped to [first covered line, last covered line] of the intersection; otherwise (or with start > end, start < 1, or partial nulls) the anchor is dropped and the risk is kept with its file refs. Clipping is neither flagged nor counted. A risk whose refs are only blast caller files has no anchor. The stored schema enforces `anchor.file ∈ file_refs` (AC-88..AC-92, AC-98).
- **D-18. `dropped_anchors`.** `meta.grounding.dropped_anchors` counts stored risks where the model supplied at least one non-null anchor value and no anchor was stored; all-null anchors and risks dropped by AC-14 are not counted. The field is optional in `BriefMeta` and reads as 0 for rows stored before revision 4; it is written to the log line (AC-93..AC-95).
- **D-19. Anchor UI and navigation.** The risk header label is `file:start-end`, `file:line` when start equals end, or the plain first file ref when there is no anchor. The navigate control for the anchor file opens Files changed at `start_line` through the existing deep link (`?tab=diff&file=&line=`) when the file is in the current diff; otherwise the toast rules apply (AC-99, AC-100).
- **D-20. Cost and tokens in the header.** The card header shows the brief's own generation cost and token usage from `meta.cost_usd`, `meta.tokens_in`, `meta.tokens_out`: cost as `$` with 3 decimals (`<$0.001` when positive below that), tokens as `in→out` with counts from 1,000 up in thousands with one decimal and a `K` suffix and plain integers below. Null parts are omitted (a lone token count gets an `in`/`out` word); the whole line is omitted when all three are null. Its accessible name and `title` are spelled out, its strings come from `brief.json` keys under `card.costTokens*`, and it stays visible with the brief while stale or regenerating. Nothing new is stored (AC-101..AC-107).

### Known limitations accepted for this iteration

- The brief routes access the database and hold the in-memory rate limiter themselves, following the same pattern as the existing Intent routes. Extracting this into a service and sharing the cooldown is future work.
- An in-flight guard rejects a second POST for the same PR with 429 while a generation for it is still running, even after the 30 s cooldown has elapsed; in that case `retry_after` (AC-31, AC-72) is at least 1.
- Classification of failures into the 502 outcomes currently matches the LLM adapter's error message text.
- The e2e checks for AC-28 (reload shows the same brief), AC-38 (highlighted line row) and AC-76 (Back navigation) are not automated; component and unit tests cover these behaviors.

## Open questions

None. OQ-1..OQ-12 are resolved as decisions D-1..D-6 and D-9..D-14. The revision 4 additions are fully decided (D-15..D-20).

### Design coverage gaps (from `screen_pr_detail.jsx`) and proposals

- **No error state.** Add an inline error with Retry (AC-34). Keep the previous brief.
- **No stale badge.** Add a badge next to the card title with Regenerate (AC-29).
- **No rate-limit message.** Show inline status text with the remaining seconds, saying generation was recently started (AC-32, AC-72).
- **No regenerate-loading state.** Keep the old brief dimmed with "Regenerating…" (AC-53). The design reuses the skeleton, which hides content the reviewer may be reading.
- **No diff stats block.** Show a compact stats row in the card header (AC-55).
- **No attached-specs / sources block.** Show source chips with statuses, reusing the Intent sources style (AC-55).
- **No handling for a line outside a hunk.** Server-side snapping (AC-16) plus a header-scroll fallback (AC-39).
- **No missing-data note.** Added (AC-7).
- **No inputs-changed hint.** Added (AC-78).
- **Risk row is both expandable and clickable in the design.** Split into a chevron expand control and separate navigate controls (AC-51, AC-73).
- **History accordion.** Out of scope (non-goal). The right column holds Blast radius only.
- **Regenerate placement.** The design puts Regenerate inside VerdictBanner, which is P3 and depends on a review run. Proposal: the Regenerate control lives in the PR Brief card header regardless of the banner (AC-10).
- **Tab key.** The design uses `files`. The app's real Files changed tab key is `diff` (`PrDetailHeader.tsx`, `page.tsx`), so navigation uses `?tab=diff`.
- **DiffTab today accepts no navigation target.** File cards auto-expand only below a line threshold. AC-35–AC-39 and AC-74, AC-75, AC-83 require an external "open this file / scroll to this line" input driven by URL params.
- **Risk anchor in the design.** The prototype gives each risk `anchor {file, line}` and shows ranges such as `src/middleware/ratelimit.ts:12-18`, and it assumes every risk has an anchor. The spec makes the anchor optional, a range (`start_line`..`end_line`), tied to one of the risk's own file refs and validated against hunk ranges by code (AC-85..AC-100). The design does not cover a risk without an anchor (plain file label, AC-99), an anchor on a blast-only file (dropped, AC-89) or an anchor file no longer in the diff (toast, AC-100).
- **Cost and tokens in the design header.** The design shows `$0.014  8.2K→1.3K` but does not cover missing usage, a single reported count, very small costs, or an accessible reading of `K` and `→`. Covered by AC-101..AC-107.

### Research suggestions (via caller, optional)

- How `loadDiff` can expose a `loaded` (possibly zero files) vs `unavailable` result and per-file hunk new-side line ranges (needed for AC-16, AC-20, AC-48, AC-59) without forwarding bodies.
- Whether the OpenAI adapter's `completeStructured` reports `attempts`, as the Intent tests assume, for the `risk_brief` default provider (needed for AC-18, AC-26).

### Verification notes

- `get_blast_radius` was not applicable: there is no PR for this feature yet.
- Facts verified in code (revision 1): the tab key `diff`, the `risk_brief` default (`openai`/`gpt-4.1`), the `pr_brief(pr_id, json)` table, the Intent rate limit (30 s, 429/502 with `retry_after`), that Blast is not cached, and that no Project Context module exists.
- Revision 2 inputs: `docs/plans/pr-brief-cross-review.md` and the user's decisions D-1..D-8. The 50 s model-call cap matches the plan's `BRIEF_LLM_TIMEOUT_MS`.
- Revision 3 inputs: the user's confirmation of the OQ-7..OQ-12 defaults (D-9..D-14) and corrections found during planning (diff-facts exclusion wording, AC-26 outcome list, AC-64 verification, AC-70 zero usage).
- Revision 4 inputs: the user's requests for a risk line range and for cost/tokens in the brief header, and the design prototype `screen_pr_detail.jsx` (risks carry `anchor {file, line}`). Checked in code: both `brief.ts` copies (`server/src/vendor/shared/contracts/brief.ts`, `client/src/vendor/shared/contracts/brief.ts`) have `meta.grounding` with `dropped_risks`, `dropped_refs`, `dropped_focus`, `adjusted_lines` and no `dropped_anchors`; `RiskList.tsx` today shows the first file ref in the collapsed header and navigates refs by file only (no line). Because GET treats unparsable rows as "no brief", `dropped_anchors` must be optional and `anchor` optional for pre-revision rows to keep showing (AC-97). `get_blast_radius` was not run for revision 4 (the change is a spec amendment, not a PR).
