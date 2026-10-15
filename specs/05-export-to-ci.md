# Spec: Export to CI
Spec ID: SPEC-05
Status: approved (assumptions A-1..A-18 accepted by default, per the user's "pick the simplest option" instruction)

Revision note: rev 1, first draft for worktree B of the L07 lab (branch `feat/export-to-ci`, worktree `dev-digest-wt-export-ci`). The user asked for the simplest viable option everywhere: every unknown was resolved with a default, recorded as `A-n` under "Open questions". The lab text names the file `specs/export-to-ci.md`; this repository numbers specs (`specs/README.md`), so it lives at `specs/05-export-to-ci.md` (see OQ-1). Worktree A (Multi-Agent Review) has its own spec and is merged first.

## Problem and user

A DevDigest agent that a team has tuned in the studio (system prompt, model, skills, gate policy) only runs on one developer's machine, against PRs that someone imports and reviews by hand. The team cannot rely on it for every PR: nothing runs it automatically, nothing blocks a merge, and the result of a run is not visible to anyone else.

Export to CI moves the agent's configuration into the target repository as versioned files and runs the review in that repository's own GitHub Actions on every pull request. The CI run uses the same `reviewer-core` pipeline (injection guard, grounding gate, deterministic verdict) as a local run. The studio then pulls the result back and shows it next to local runs.

User: a DevDigest workspace member who owns a review agent and has a GitHub repository connected to the studio. They (1) export the agent to CI through a four-step wizard that opens a PR on a separate branch (or download the files as a zip), (2) review and merge that PR themselves after adding the `OPENROUTER_API_KEY` secret, (3) see every CI review in a CI Runs page and in the agent's CI tab, and (4) choose the severity at which the CI check fails.

Same manifest does not mean byte-identical results: the model can answer differently and CI can have other tool versions. The CI run record therefore keeps the agent version, the model, the runner version and the commit SHA.

## Goals / Non-goals

### Goals

- **G1 Export wizard.** From the agent's CI tab ("Add to CI"), a four-step modal wizard: Target -> Preview -> Configure -> Install, with GitHub Actions as the only real target.
- **G2 Generated files.** The studio deterministically generates the manifest `.devdigest/agents/<slug>.yaml` (validated with the same `AgentManifest` Zod schema the runner uses), the linked skill bodies, `.devdigest/memory.jsonl`, the bundled runner `.devdigest/runner/index.js` and an editable `.github/workflows/devdigest-review.yml`.
- **G3 Safe install.** Install either opens a PR from branch `devdigest/ci` into the repository's default branch (never writes to the default branch) or downloads the same files as a zip. Missing GitHub token scopes give a clear error and the zip path still works.
- **G4 Secure workflow.** The generated workflow uses least-privilege permissions, keeps `OPENROUTER_API_KEY` in GitHub Secrets only, never uses `pull_request_target`, never runs code from the PR, never interpolates untrusted PR text into shell, and pins external actions to full commit SHAs.
- **G5 CI execution and gate.** The workflow runs the bundled `agent-runner`, which posts the result per the chosen mode (GitHub review, PR comment, or none) and exits non-zero when the "Fail CI on" gate triggers, so a required check can block merges.
- **G6 Verified ingest.** The studio pulls `devdigest-result.json` through a verified channel, validates schema, commit SHA and repository id, and records the run as `agent_runs.source = 'ci'` plus a `ci_runs` row.
- **G7 CI Runs page.** A page listing CI runs with repository, PR, agent, verdict, findings, cost, duration, status and a link to the GitHub Actions job.
- **G8 Agent CI tab.** The agent editor gets a CI tab with installations, workflow version, run history and the "Fail CI on" setting.
- **G9 Parallel-work boundaries.** Worktree B changes only the files it owns (see "Ownership and merge order"), merges after worktree A, and passes its verification commands.

### Non-goals

- CircleCI, Jenkins and Generic CLI targets. No generators exist; the wizard does not show them (A-1).
- A published marketplace action (`uses: devdigest/review-action@v1`). The workflow runs the runner bundle committed in the repository.
- An inbound webhook or public ingest URL. The studio runs locally; GitHub cannot reach it. Ingest is a pull initiated by the studio (A-6).
- Background polling of GitHub. Sync happens when the CI Runs page or CI tab opens and on "Refresh" (A-8).
- Reviewing PRs from forks. The generated job is skipped for fork PRs (A-12).
- Several agents in one repository. The runner accepts exactly one manifest per repository; a second agent for the same repository is refused (A-4).
- Uninstalling CI from the studio, deleting installations, or editing the manifest/skills by hand in the wizard. Only the workflow file is editable (A-9).
- Making the check required, configuring branch protection or rulesets, or setting the GitHub secret. These are manual repository settings; the wizard only explains them.
- Repo-intel context, project context (SPEC-02), PR intent and memory in CI prompts. `memory.jsonl` is exported but the runner does not read it in this version (A-10).
- Persisting individual CI findings as `findings` rows, Accept/Dismiss on CI findings, and opening CI runs in the Run Trace drawer. CI findings live in the GitHub review; the studio stores counts (A-7, A-11).
- Grouping CI runs into `multi_agent_runs` (worktree A's feature).
- Filters, pagination and a live status for in-progress CI runs on the CI Runs page (A-8).
- Any change to this repository's own `.github/workflows/`.

## User stories

- **US-1 (G1, G2).** As an agent owner, I open my agent's CI tab, click "Add to CI", pick a connected repository and GitHub Actions, and preview every file the studio will add before anything leaves the studio.
- **US-2 (G2, G4).** As an agent owner, I adjust the workflow YAML in the preview (for example the Node version), and the studio refuses my edit if it would weaken the security rules.
- **US-3 (G1, G5).** As an agent owner, I choose which `pull_request` events trigger the review and whether the result is posted as a GitHub review, a PR comment or only an exit code.
- **US-4 (G3).** As an agent owner, I click "Open a PR" and get a link to a PR on branch `devdigest/ci`; I review its permissions, triggers, secret handling and code execution before I merge it.
- **US-5 (G3).** As an agent owner whose studio token cannot write workflow files, I see exactly which GitHub scope is missing and download the files as a zip instead.
- **US-6 (G5).** As a team lead, I set "Fail CI on: Critical", update the CI config, mark the check as required in branch protection, and a PR with a critical finding cannot be merged.
- **US-7 (G6, G7).** As a team member, I open CI Runs and see every automated review with its repository, PR, agent, verdict, findings, cost, duration and a link to the GitHub Actions job.
- **US-8 (G8).** As an agent owner, I see in the agent's CI tab where the agent is installed, which workflow version each repository has, and the agent's recent CI runs.
- **US-9 (G4, G6).** As a security reviewer, I can confirm that the API key never appears in the manifest, the artifact, the logs or the studio database, and that a forged artifact is not accepted.

## Acceptance criteria (EARS)

Terms used throughout:

- **Installation**: a `ci_installations` row: one agent installed in one connected repository with the GitHub Actions target.
- **Bundle**: the set of generated files for one agent and one repository (manifest, skill files, `memory.jsonl`, runner, workflow).
- **Result artifact**: the `devdigest-result.json` file the runner writes, validated by the `CiResultArtifact` Zod schema.
- **Sync**: the studio-initiated pull that lists GitHub Actions runs of the generated workflow and ingests their result artifacts.
- **Studio token**: the server's `GITHUB_TOKEN` secret used by Octokit. **Actions token**: the `GITHUB_TOKEN` GitHub injects into the workflow run.

Each AC names its goal. Verification hints are in italics. AC-91 was added after the first numbering pass and sits in the Install section to keep references stable.

### Wizard: entry and Target step (G1)

- **AC-1 (G1, G8).** The agent editor (shall) have a "CI" tab reachable by the deep link `?tab=ci`.
  *Verify:* AgentEditor test asserts `ci` is in the tab keys and `?tab=ci` renders the CI tab.
- **AC-2 (G1).** КОЛИ the user clicks "Add to CI" in the CI tab, the system (shall) open the Export to CI wizard as a modal dialog with the step indicator Target, Preview, Configure, Install and the Target step active.
  *Verify:* CiTab component test: click "Add to CI", assert dialog role, four step labels (reused `ExportWizardSteps`), step 1 active.
- **AC-3 (G1).** The Target step (shall) show GitHub Actions as the only target, preselected, and no CircleCI, Jenkins or Generic CLI option.
  *Verify:* Wizard test asserts one target option "GitHub Actions" and absence of the other three names.
- **AC-4 (G1).** The Target step (shall) let the user pick one repository from the repositories connected to the current workspace.
  *Verify:* Wizard test with two mocked repos asserts both are selectable.
- **AC-5 (G1).** ПОКИ no repository is selected, the system (shall) keep "Continue" disabled in the Target step.
  *Verify:* Wizard test asserts the disabled state before and enabled state after selection.
- **AC-6 (G1).** ЯКЩО the workspace has no connected repository, ТОДІ the Target step (shall) show "Connect a repository first" with a link to the repository setup instead of the picker.
  *Verify:* Wizard test with an empty repo list.
- **AC-7 (G1).** ЯКЩО the agent's provider is not `openrouter`, ТОДІ the wizard (shall) show "CI export supports OpenRouter agents only" and keep "Continue" disabled.
  *Verify:* Wizard test with an `openai` agent fixture; server test: preview/export of a non-OpenRouter agent answers 400 `ci_provider_unsupported`.
- **AC-8 (G1).** ЯКЩО the selected repository already has an installation of a different agent, ТОДІ the system (shall) refuse to continue with the message "<repo> already runs agent <name> in CI; one agent per repository is supported".
  *Verify:* Server test: export for a second agent in the same repo answers 409 `ci_repo_taken`; wizard test renders the message.
- **AC-9 (G1).** КОЛИ the user presses Escape or the close button, the system (shall) close the wizard without creating any installation, branch or file, and return focus to the button that opened it.
  *Verify:* Wizard test asserts no export request is sent and focus returns.
- **AC-10 (G1).** КОЛИ the user clicks "Back", the system (shall) show the previous step with the user's earlier choices and edits kept.
  *Verify:* Wizard test: edit workflow, go to Configure, Back, assert the edit is still present.

### Preview step and generated files (G2, G4)

- **AC-11 (G2).** КОЛИ the Preview step opens, the system (shall) request the bundle preview from the server for the selected agent, repository and current Configure values, and show the file list: `.devdigest/agents/<slug>.yaml`, one `.devdigest/skills/<skill-slug>.md` per linked enabled skill, `.devdigest/memory.jsonl`, `.devdigest/runner/index.js` and `.github/workflows/devdigest-review.yml`.
  *Verify:* Server unit test of the bundle generator for an agent with two skills asserts the exact path list; wizard test asserts the list renders.
- **AC-12 (G2).** КОЛИ the user selects a file in the Preview list, the system (shall) show its full contents read-only, except the workflow file, which (shall) be editable, and the runner bundle, which (shall) show only its size and runner version instead of its contents.
  *Verify:* Wizard test: manifest view has no editable textbox; workflow view has one; runner view shows size text.
- **AC-13 (G2).** The generated manifest (shall) validate against the shared `AgentManifest` schema and contain the agent's name, provider, model, system prompt, ordered skill slugs, strategy, `ci_fail_on` and agent version.
  *Verify:* Server unit test: `AgentManifest.safeParse(parseYaml(manifest))` succeeds and fields equal the agent fixture.
- **AC-14 (G2).** The same manifest file (shall) be accepted by `agent-runner`'s manifest loader.
  *Verify:* agent-runner test loads a manifest fixture produced by the server generator (checked-in fixture shared by both tests) and asserts success.
- **AC-15 (G2).** The skill slug (shall) be the kebab-case of the skill name, and ЯКЩО two linked skills produce the same slug, ТОДІ the later one (shall) get a numeric suffix (`-2`, `-3`), with the manifest listing the suffixed slugs.
  *Verify:* Server unit test with two skills named "Secret Gate" and "secret-gate".
- **AC-16 (G2).** `.devdigest/memory.jsonl` (shall) contain one JSON object per line with only `kind`, `scope` and `content` for the workspace's memory entries scoped to the selected repository, and (shall) be an empty file when there are none.
  *Verify:* Server unit test asserts line count, the allowed key set (no ids, embeddings or timestamps), and the empty case.
- **AC-17 (G2).** ЯКЩО the runner bundle has not been built, ТОДІ the preview and export (shall) fail with the error "Runner bundle not found. Build it with `pnpm build` in agent-runner/" and no installation (shall) be created.
  *Verify:* Server unit test with a missing bundle path answers 400 `ci_runner_missing`.
- **AC-18 (G2).** Generation of the bundle (shall) be deterministic: the same agent version, repository and Configure values (shall) produce byte-identical files.
  *Verify:* Server unit test generates twice and compares.
- **AC-19 (G2, G8).** The generated workflow (shall) start with a comment carrying the workflow version (`# devdigest-workflow-version: <n>`), and the installation (shall) store that version.
  *Verify:* Server unit test on the header and on the stored installation.

### Workflow security contract (G4)

The generated workflow is a data contract. An illustrative skeleton (SHAs are placeholders; the generator owns the real pinned values):

```yaml
# devdigest-workflow-version: 1
name: DevDigest Review
on:
  pull_request:
    types: [opened, synchronize]        # from Configure
permissions:
  contents: read
  pull-requests: write
jobs:
  devdigest-review:
    name: devdigest-review
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<40-hex-sha> # vX
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          persist-credentials: false
      - uses: actions/setup-node@<40-hex-sha> # vX
        with: { node-version: 22 }
      - name: Run DevDigest review
        if: hashFiles('.devdigest/runner/index.js') != ''
        run: node .devdigest/runner/index.js
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          DEVDIGEST_POST_AS: github_review  # from Configure
      - uses: actions/upload-artifact@<40-hex-sha> # vX
        if: always()
        with:
          name: devdigest-result
          path: devdigest-result.json
          if-no-files-found: ignore
```

- **AC-20 (G4).** The generated workflow (shall) declare top-level `permissions` with exactly `contents: read` and `pull-requests: write` and no other permission key.
  *Verify:* Server unit test parses the YAML and compares the permissions map.
- **AC-21 (G4).** The generated workflow (shall) trigger only on `pull_request` with the types chosen in Configure, and (shall) never contain `pull_request_target`, `workflow_run`, `issue_comment` or `push` triggers.
  *Verify:* Server unit test over every trigger combination.
- **AC-22 (G4).** The generated workflow (shall) check out the PR's base commit (`github.event.pull_request.base.sha`) with `persist-credentials: false`, so no code from the PR head is executed in the job.
  *Verify:* Server unit test asserts the checkout `ref` and `persist-credentials`.
- **AC-23 (G4).** The generated job (shall) run only when the PR head repository equals the base repository, so the job is skipped for fork PRs.
  *Verify:* Server unit test asserts the job-level `if` expression.
- **AC-24 (G4).** The generated workflow (shall) reference `OPENROUTER_API_KEY` only as `${{ secrets.OPENROUTER_API_KEY }}` in the `env` of the review step, and no generated file (shall) contain an API key value.
  *Verify:* Server unit test: the only occurrence of the name is that env entry; a test with the studio's secrets provider returning a fake key asserts the fake value is absent from every generated file.
- **AC-25 (G4).** The generated workflow (shall) pass PR data to the runner only through `env` (`PR_NUMBER`), and (shall) never place `github.event.pull_request.title`, `.body`, `.head.ref` or any comment text inside a `run:` script.
  *Verify:* Server unit test asserts no `${{` expression appears in any `run:` value.
- **AC-26 (G4).** Every `uses:` in the generated workflow (shall) reference an action by a full 40-character commit SHA.
  *Verify:* Server unit test applies the regex `@[0-9a-f]{40}` to every `uses:` value.
- **AC-27 (G4, G6).** The generated workflow (shall) upload `devdigest-result.json` as an artifact named `devdigest-result` even when the review step fails, and (shall) not fail the upload when the file is absent.
  *Verify:* Server unit test asserts `if: always()` and `if-no-files-found: ignore` on the upload step.
- **AC-28 (G4).** The review step (shall) be skipped when the runner bundle is absent at the base commit (the install PR itself is not reviewed).
  *Verify:* Server unit test asserts the `hashFiles` condition on the review step.
- **AC-29 (G4).** ЯКЩО the user's edited workflow is not valid YAML, adds a permission other than `contents: read` and `pull-requests: write` (including `write-all`), adds `pull_request_target`, removes the fork guard, removes the base-SHA checkout, uses an action not pinned to a full SHA, places a `${{ }}` expression in a `run:` script, or assigns `OPENROUTER_API_KEY` anything other than `${{ secrets.OPENROUTER_API_KEY }}`, ТОДІ the export (shall) be refused with error `ci_workflow_unsafe` naming the violated rule, and the wizard (shall) show that message on the Preview step.
  *Verify:* Server unit test: one case per rule answers 400 with the rule name; wizard test renders the message.
- **AC-30 (G4).** КОЛИ the user's edited workflow passes the checks of AC-29, the export (shall) use the edited contents instead of the generated workflow.
  *Verify:* Server unit test: export with a changed `node-version` commits that exact text.

### Configure step (G1, G5)

- **AC-31 (G1).** The Configure step (shall) offer the triggers `pull_request: opened`, `synchronize` and `reopened`, with `opened` and `synchronize` selected by default.
  *Verify:* Wizard test asserts the three options and the default selection.
- **AC-32 (G1).** ПОКИ no trigger is selected, the system (shall) keep "Continue" disabled in the Configure step and show "Pick at least one event".
  *Verify:* Wizard test.
- **AC-33 (G1, G5).** The Configure step (shall) offer "Post results as" with the options GitHub review (default), PR comment and None (exit code only), and the chosen value (shall) be written to the workflow as `DEVDIGEST_POST_AS` with the values `github_review`, `pr_comment` or `none`.
  *Verify:* Server unit test per option asserts the env value; wizard test asserts the default.
- **AC-34 (G1, G5).** The Configure step (shall) show the current "Fail CI on" value of the agent and the text "To block merges, make the `devdigest-review` check required in the repository's branch protection or ruleset. DevDigest cannot do this for you."
  *Verify:* Wizard test asserts the value and the text.
- **AC-35 (G1).** КОЛИ a Configure value changes and the user returns to Preview, the system (shall) show the regenerated workflow; ЯКЩО the user had edited the workflow, ТОДІ the system (shall) ask "Discard your workflow edits and regenerate?" before replacing it.
  *Verify:* Wizard test for both paths.

### Install step (G3)

- **AC-36 (G3).** The Install step (shall) offer "Open a PR with these files" (recommended) and "Download files as zip", and (shall) state that the PR is opened from branch `devdigest/ci` into the repository's default branch and that branch `devdigest/ci` is overwritten if it exists.
  *Verify:* Wizard test asserts both options and the text.
- **AC-37 (G3).** КОЛИ the user chooses "Open a PR", the system (shall) commit the bundle as one commit to branch `devdigest/ci` created from the repository's default branch, and open a PR from `devdigest/ci` into the default branch titled "Add DevDigest CI review (<agent name>)".
  *Verify:* Server unit test with the mock GitHub client asserts the commit branch, base and PR title.
- **AC-38 (G3).** The export (shall) never create a commit on, or move the ref of, the repository's default branch or any branch other than `devdigest/ci`.
  *Verify:* Server unit test asserts every recorded ref write targets `devdigest/ci`.
- **AC-39 (G3).** ЯКЩО an open PR from `devdigest/ci` already exists, ТОДІ the export (shall) add the new commit to that branch and return the existing PR's URL instead of opening a second PR.
  *Verify:* Server unit test with `findOpenPr` returning a URL asserts no second `openPullRequest` call.
- **AC-40 (G3, G4).** The PR body (shall) contain the list of added files, a manual review checklist (permissions, triggers, secret handling, which commit's code runs), the instruction to add `OPENROUTER_API_KEY` under Settings -> Secrets and variables -> Actions, and the note that blocking merges needs a required check.
  *Verify:* Server unit test asserts the four sections in the body.
- **AC-41 (G3).** КОЛИ the PR is opened or reused, the wizard (shall) show a success state with a link to the PR, the secret setup instruction with a link to the repository's Actions secrets settings page, and "Done".
  *Verify:* Wizard test with a mocked success response.
- **AC-42 (G3).** ЯКЩО GitHub rejects the commit because the studio token lacks the `workflow` scope (classic token) or Workflows write permission (fine-grained token), ТОДІ the export (shall) fail with error `github_workflow_scope_missing` and the message "The studio GitHub token cannot add files under .github/workflows/. Give it the `workflow` scope (classic) or Workflows: Read and write (fine-grained), or download the zip and add the files yourself."
  *Verify:* Server unit test: the mock client throws GitHub's "refusing to allow ... without `workflow` scope" error; assert code and message.
- **AC-43 (G3).** ЯКЩО the export fails with `github_workflow_scope_missing`, ТОДІ the wizard (shall) keep the user on the Install step with the message shown and "Download files as zip" enabled.
  *Verify:* Wizard test with the error response.
- **AC-44 (G3).** ЯКЩО GitHub rejects the commit or PR for lack of write access (403 or 404), ТОДІ the export (shall) fail with error `github_write_denied` and a message naming the repository and the needed `contents` and `pull-requests` write access.
  *Verify:* Server unit test.
- **AC-45 (G3).** ЯКЩО the export fails for any other GitHub or network error, ТОДІ the wizard (shall) show the error and a "Try again" action, and retrying (shall) not create a second PR (AC-39).
  *Verify:* Wizard test; server test of retry after a failed `openPullRequest`.
- **AC-46 (G3).** КОЛИ the user chooses "Download files as zip", the system (shall) download `devdigest-ci-<repo-name>.zip` containing exactly the bundle files at their repository paths.
  *Verify:* Server unit test opens the zip and compares entry names and contents with the preview.
- **AC-47 (G3).** The zip download (shall) work without any GitHub call.
  *Verify:* Server unit test with a GitHub mock that throws on every method.
- **AC-48 (G3, G8).** КОЛИ an export succeeds (PR opened, PR reused or zip downloaded), the system (shall) create or update the single installation for that agent and repository with target `gha`, workflow version, exported agent version, exported `ci_fail_on`, post mode, triggers, the list of exported file paths, PR URL (null for zip) and the GitHub repository id (null for zip until the first sync reads it from GitHub).
  *Verify:* Server integration test (`.it.test`) asserts the stored row after each path.
- **AC-49 (G3).** ЯКЩО the export fails, ТОДІ the system (shall) not create or change an installation.
  *Verify:* Server unit test of the failure paths asserts no repository write.
- **AC-50 (G3).** ПОКИ an export request is in flight, the system (shall) disable both Install options and show a progress indicator.
  *Verify:* Wizard test with a pending mutation.
- **AC-91 (G2, G3).** ЯКЩО an agent that already has an installation in the repository is exported again and its slug differs from the slug recorded on the installation, ТОДІ the export (shall) be refused with the error code `ci_slug_changed` and no GitHub write (shall) happen. Stale skill files from a previous export stay in the repository; the runner reads only skills listed in the manifest. *Verification: unit test on the export service with a changed slug; asserts the error code and zero `commitFiles` calls.*
  *Verify:* Server unit test on the export service with a changed slug: asserts the error code `ci_slug_changed` and zero `commitFiles` calls.

### Runner behavior in CI (G5, G6)

- **AC-51 (G5).** КОЛИ the review step runs, the runner (shall) review the PR with the manifest and skills from the checked-out base commit and the diff fetched from the GitHub API, through the same `reviewer-core` pipeline with the grounding gate.
  *Verify:* Existing agent-runner `run.test.ts` parity tests stay green.
- **AC-52 (G5).** КОЛИ the deterministic gate against the manifest's `ci_fail_on` triggers, the runner (shall) exit with code 1, which makes the `devdigest-review` check fail.
  *Verify:* Existing agent-runner gate test; manual check in the lab flow (red check on a PR with a critical finding).
- **AC-53 (G5).** ЯКЩО the runner fails before it has a grounded review (missing secret, invalid manifest, diff or model error), ТОДІ it (shall) exit with code 1, post nothing and write no result artifact (fail closed).
  *Verify:* Existing agent-runner hard-fail test.
- **AC-54 (G6).** The result artifact (shall) contain, in addition to the existing fields, the PR head commit SHA, the GitHub repository id, the model, the agent version from the manifest and the deterministic verdict (`APPROVE`, `COMMENT` or `REQUEST_CHANGES`).
  *Verify:* agent-runner test asserts the fields from a fixture event payload (`pull_request.head.sha`) and `GITHUB_REPOSITORY_ID`; `CiResultArtifact.safeParse` succeeds.
- **AC-55 (G4, G6).** The result artifact, the runner's stdout and stderr, and every posted review or comment (shall) not contain the value of `OPENROUTER_API_KEY` or `GITHUB_TOKEN`.
  *Verify:* agent-runner test with fake key values asserts they are absent from the written artifact, captured logs and posted payloads, on both success and failure paths.

### Ingest (G6)

- **AC-56 (G6).** КОЛИ a sync runs, the system (shall) list, for each installation, the most recent completed GitHub Actions runs (at most 30) of `devdigest-review.yml` through the GitHub API with the studio token, and ingest each run not yet stored.
  *Verify:* Server unit test with a mock source returning runs, some already stored.
- **AC-57 (G6).** The system (shall) accept a result only from the `devdigest-result` artifact of a run that the GitHub API reports for the installation's repository; there (shall) be no endpoint that accepts an artifact body from a caller.
  *Verify:* Route test asserts the sync route takes no artifact payload; code review of the route list.
- **AC-58 (G6).** КОЛИ the system ingests an artifact, it (shall) validate it with `CiResultArtifact`, keep only the schema's fields, and reject an archive larger than 1 MB, a JSON file larger than 64 KB, an archive with any entry other than `devdigest-result.json`, or an entry name with a path separator or `..`.
  *Verify:* Server unit test per rejection case and one valid case.
- **AC-59 (G6).** ЯКЩО the artifact's commit SHA differs from the run's `head_sha`, ТОДІ the system (shall) reject the artifact.
  *Verify:* Server unit test.
- **AC-60 (G6).** ЯКЩО the artifact's repository id differs from the run's repository id or from the installation's repository id (read from GitHub and stored on the first sync when it is still null), ТОДІ the system (shall) reject the artifact.
  *Verify:* Server unit test for both mismatches and for the null-then-filled case.
- **AC-61 (G6).** ЯКЩО the run reports associated PR numbers and the artifact's PR number is not among them, ТОДІ the system (shall) reject the artifact.
  *Verify:* Server unit test.
- **AC-62 (G6).** КОЛИ an artifact is rejected, the system (shall) store the CI run with status `failed` and a reason "Result rejected: <rule>", store none of the artifact's counts, and log a warning with the installation, run id and rule but not the artifact contents.
  *Verify:* Server unit test asserts the row and the log call.
- **AC-63 (G6).** ЯКЩО a completed run has no `devdigest-result` artifact or the artifact has expired, ТОДІ the system (shall) store the CI run with status `failed` and reason "No result artifact (the job failed before producing a result)".
  *Verify:* Server unit test.
- **AC-64 (G6).** КОЛИ a valid artifact is ingested, the system (shall) create one `agent_runs` row with `source = 'ci'`, the installation's agent and workspace, the model, duration, cost, findings count, severity counts and blockers from the artifact, and the PR link when that PR is imported in the studio (otherwise no PR link).
  *Verify:* Server integration test asserts the row fields for an imported and a non-imported PR.
- **AC-65 (G6).** КОЛИ a run is ingested (valid or not), the system (shall) store one `ci_runs` row with the installation, GitHub run id, PR number, PR title from the run, commit SHA, ran-at time, status, verdict, findings count, severity counts, cost, duration, model, agent version, runner version, workflow version, reason and the job URL, linked to its `agent_runs` row when one was created.
  *Verify:* Server integration test.
- **AC-66 (G6).** The status of an ingested valid run (shall) be `no_findings` when its findings count is 0 and `succeeded` otherwise, regardless of whether the gate failed the check; the gate result (shall) be shown by the verdict.
  *Verify:* Server unit test of the mapping.
- **AC-67 (G6).** The same GitHub run (shall) be stored at most once, also when two syncs run at the same time.
  *Verify:* Server integration test runs two syncs concurrently and asserts one row per run id (unique constraint).
- **AC-68 (G6).** ЯКЩО a sync fails for one installation (GitHub error, timeout, missing Actions read access), ТОДІ the system (shall) still sync the other installations and return the failure per repository with an error code and message.
  *Verify:* Server unit test with one failing installation.
- **AC-69 (G6).** ЯКЩО the studio token cannot read Actions runs or artifacts of a repository, ТОДІ the sync (shall) report error `github_actions_read_denied` for that repository with the message "The studio GitHub token cannot read GitHub Actions in <repo>. It needs Actions: Read (fine-grained) or the `repo` scope (classic)."
  *Verify:* Server unit test with a 403 from the mock source.

### CI Runs page (G7)

- **AC-70 (G7).** The sidebar (shall) contain a "CI Runs" item that opens `/ci-runs` and is marked active on that route.
  *Verify:* Client test of the nav list and `activeKeyFor("/ci-runs")`.
- **AC-71 (G7).** КОЛИ the CI Runs page opens, the system (shall) start a sync and show the stored runs at once, then refresh the list when the sync finishes.
  *Verify:* Page test with mocked hooks asserts both requests and the list update.
- **AC-72 (G7).** The CI Runs page (shall) list at most the 100 most recent CI runs of the workspace, newest first, each row showing time, repository, PR number and title, agent, verdict, findings by severity, cost, duration, status and a "View job" link to the GitHub Actions run.
  *Verify:* Page test with a fixture of mixed runs asserts columns and order; server test of the 100 limit and order.
- **AC-73 (G7).** The "View job" link (shall) open the GitHub Actions run URL in a new tab with `rel="noopener noreferrer"`.
  *Verify:* Page test asserts `href`, `target` and `rel`.
- **AC-74 (G7).** A row for a failed run (shall) show the status "Failed" with its reason, and "—" for verdict, findings, cost and duration that are not known.
  *Verify:* Page test with a failed fixture.
- **AC-75 (G7).** КОЛИ the user clicks "Refresh", the system (shall) run a sync, show a progress indicator on the button while it runs, and update the list and the "Last synced <time>" text when it ends.
  *Verify:* Page test.
- **AC-76 (G7).** ЯКЩО a sync reports per-repository failures, ТОДІ the page (shall) show a warning listing each failed repository with its message, and still show the stored runs.
  *Verify:* Page test with a partial-failure response.
- **AC-77 (G7).** ПОКИ the list is loading for the first time, the page (shall) show a loading state; ЯКЩО loading fails, ТОДІ the page (shall) show an error with "Try again".
  *Verify:* Page test for both states.
- **AC-78 (G7).** ЯКЩО there are no CI runs and no installations, ТОДІ the page (shall) show "No CI runs yet. Once you export an agent to CI, every automated review shows up here." with a "Set up CI for an agent" link to `/agents`.
  *Verify:* Page test.
- **AC-79 (G7).** ЯКЩО there are installations but no CI runs, ТОДІ the page (shall) show "No CI runs yet. Runs appear after the DevDigest PR is merged and a pull request triggers the workflow."
  *Verify:* Page test.
- **AC-80 (G7, G4).** The PR title and any other text that came from GitHub (shall) be rendered as plain text, never as HTML or markdown, and "View job" (shall) link only to `https://github.com/` URLs.
  *Verify:* Page test with a title containing `<img onerror>` asserts literal text; a non-GitHub job URL renders no link.

### Agent CI tab (G8)

- **AC-81 (G8).** ЯКЩО the agent has no installation, ТОДІ the CI tab (shall) show "Not in CI yet" with the "Add to CI" action.
  *Verify:* CiTab test with an empty response.
- **AC-82 (G8).** ПОКИ the agent has installations, the CI tab (shall) list each with repository, target "GitHub Actions", workflow version, install time, PR link (or "Files downloaded" for zip installs), and the last run's status and time (or "No runs yet").
  *Verify:* CiTab test with two installation fixtures.
- **AC-83 (G8).** The CI tab (shall) show "Fail CI on" with the values Never, Critical, Warning and above, and Any, bound to the agent's existing `ci_fail_on` setting (the same value as in the Config tab).
  *Verify:* CiTab test: changing the value sends the existing agent update request with `ci_fail_on`.
- **AC-84 (G8).** The CI tab (shall) state that "Fail CI on" makes the check exit non-zero and that blocking merges also needs the check to be required in the repository settings.
  *Verify:* CiTab test asserts the text.
- **AC-85 (G8).** ЯКЩО the agent's current version or `ci_fail_on` differs from what an installation exported, ТОДІ the CI tab (shall) mark that installation "Config changed since export" with an "Update CI config" action.
  *Verify:* CiTab test with a fixture where versions differ.
- **AC-86 (G8).** КОЛИ the user clicks "Update CI config" on an installation, the system (shall) open the wizard with that repository and the installation's triggers and post mode preselected.
  *Verify:* CiTab test asserts the wizard's initial values.
- **AC-87 (G8).** The CI tab (shall) list the agent's 20 most recent CI runs with the same columns as the CI Runs page except the agent, and (shall) start a sync when the tab opens.
  *Verify:* CiTab test.
- **AC-88 (G8).** The CI tab (shall) show "Add repository", which opens the wizard with no repository preselected.
  *Verify:* CiTab test.

### Boundaries and verification (G9)

- **AC-89 (G9).** The changes of worktree B (shall) be limited to the files listed as owned or shared in "Ownership and merge order".
  *Verify:* `git -C ../dev-digest-wt-export-ci diff --name-only <base>...HEAD` compared with worktree A's list; the intersection contains only files marked shared.
- **AC-90 (G9).** Before merge, the verification commands of "Ownership and merge order" (shall) pass in worktree B, both before and after rebasing on the merged worktree A.
  *Verify:* Command output recorded in the PR.

## Edge cases

- **One agent per repository.** The runner refuses more than one manifest. A second agent for the same repository is refused (AC-8). Re-exporting the same agent replaces its files on `devdigest/ci`.
- **Renamed agent.** The manifest path uses the slug of the current name. A re-export after a rename is refused with `ci_slug_changed` (AC-91, A-15), so two manifests never end up side by side.
- **Existing `devdigest/ci` branch with manual commits.** It is overwritten by the export (force update, stated in AC-36).
- **Install PR closed without merge.** The installation stays; sync finds no runs; the CI tab shows "No runs yet". The user can export again; a new PR is opened.
- **Default branch is not `main`.** The base is the connected repository's stored default branch.
- **Secret not set.** The runner hard-fails (AC-53); the check is red; no artifact; the studio shows a failed run with the "No result artifact" reason.
- **Fork PR.** The job is skipped (AC-23); no run appears in the studio.
- **Install PR itself.** The review step is skipped because the base commit has no runner yet (AC-28); the run uploads no artifact and shows as failed "No result artifact" in the studio (A-13).
- **Empty diff after stripping DevDigest files.** The runner reviews nothing and produces a zero-finding APPROVE; the studio shows `no_findings`.
- **All findings dropped by grounding.** Valid zero-finding APPROVE, not an error.
- **Huge PR.** The runner's `auto` strategy and GitHub's diff limits apply; a diff-fetch error hard-fails (AC-53).
- **Large runner bundle.** If GitHub refuses the commit for size, the export fails with the GitHub message (AC-45) and the zip path remains available.
- **More than 30 runs between syncs.** Older runs are not fetched (A-8).
- **Artifact expired** (GitHub retention). Stored as failed with the "No result artifact" reason (AC-63).
- **Concurrent syncs** (page and tab open at once, double click). No duplicates (AC-67).
- **Concurrent exports** of the same agent and repository. Both commit to `devdigest/ci`; the last commit wins; one PR exists (AC-39); one installation row exists (AC-48).
- **Agent deleted.** Installations cascade-delete; stored `ci_runs` keep their data with no installation link; `agent_runs` keep their row with no agent link (existing `set null`).
- **Repository disconnected from the studio.** Installations of that repository are not synced; stored runs stay.
- **Agent with no skills.** Manifest `skills: []`, no skill files.
- **Skill unlinked or disabled after export.** Only enabled linked skills are exported; the stale skill file stays in the repository and is ignored by the runner (AC-91, A-15).
- **PR not imported in the studio.** The CI run is stored without a PR link; the row shows the PR number and title from GitHub.
- **Malicious PR title** with HTML or prompt text. Rendered as plain text (AC-80); never reaches a shell (AC-25); reaches the model only inside the injection guard (see "Untrusted inputs").

## Non-functional requirements

- **Security.**
  - Least privilege in the workflow (AC-20), no `pull_request_target`, no PR-head code execution (AC-22), fork PRs skipped (AC-23), actions pinned by SHA (AC-26).
  - The API key exists only in GitHub Secrets and in the job's environment. It is never in the manifest, the generated files, the artifact, runner logs, posted comments, the studio database or the studio logs (AC-24, AC-55, AC-58).
  - Ingest trusts nothing in the artifact beyond schema-validated fields, cross-checks it with GitHub's own run metadata (AC-58 to AC-61), and never logs artifact contents.
  - The studio token's required permissions: Contents write, Pull requests write, Workflows write (`workflow` scope on a classic token) to open the install PR; Actions read (or `repo` on a classic token) to sync. The token configured today lacks the `workflow` scope, so "Open a PR" fails with a named error until it is added, while the zip path works (AC-42, AC-43, AC-47). The wizard never reads or writes GitHub secrets.
  - Studio API routes follow the existing local-studio model (no user authentication); no new route accepts data that becomes a CI result (AC-57).
- **Performance.** Preview responds within 2 s for an agent with up to 20 skills (excluding the first read of the runner bundle). A sync makes at most one list call plus one artifact download per new run per installation (at most 30), each with the existing GitHub timeout and retry policy; a slow repository does not block others (AC-68).
- **Observability.** The server logs one info line per export (agent, repository, mode, outcome, error code) and per sync per installation (runs seen, ingested, rejected with rules, error code). Logs never contain token values, the API key or artifact contents.
- **Accessibility.** The wizard is a dialog with an accessible name, Escape to close, focus trap and focus return (AC-9). The step indicator exposes the current step as text. Radio and checkbox groups in Configure have labels. Tables use header cells. Status is conveyed with text, not color only.
- **Internationalization.** All new UI strings go through next-intl in new message files of this feature.
- **Compatibility.** Changes to `AgentManifest` and `CiResultArtifact` are additive and optional, so manifests and artifacts produced before this change still validate (AC-13, AC-54).

## Inputs and provenance

Verified against the worktree code on 2026-10-11. The lab's "ready infrastructure" list is partly not present in this branch; the gaps are marked `[new]`. `get_blast_radius` (devdigest MCP) was not available in this session; the check used Read/Grep/Glob.

| Input or part | Status | Provenance |
|---|---|---|
| `agent-runner/` package: manifest load and validation, PR context, diff fetch and strip, `reviewer-core` pipeline, deterministic gate, artifact write, posting by mode, exit codes | exists | `[reused: agent-runner/src/*]` |
| Runner reads `DEVDIGEST_POST_AS` (closes the runner's open question about `post_as`) | exists in runner; workflow must set it | `[reused: agent-runner/src/index.ts]` |
| Runner exactly-one-manifest rule | exists | `[reused: agent-runner/src/manifest.ts]` |
| Result artifact fields `commit_sha`, `repository_id`, `model`, `agent_version`, `verdict` | missing (artifact has counts, cost, duration, agent name, runner version, PR number) | `[new: deterministic: agent-runner + additive CiResultArtifact fields]` |
| `AgentManifest` schema (shared by studio and runner) | exists; lacks agent version | `[reused: server/src/vendor/shared/contracts/eval-ci.ts]` + `[new: additive optional version field]` |
| `CiExportInput`, `CiExport`, `CiInstallation`, `CiRun`, `CiRunStatus`, `CiTarget`, `CiFile` contracts | exist (no routes use them) | `[reused: eval-ci.ts]`; additive fields for workflow override, repo id, sync result `[new]` |
| `ci/` server module (manifest serialization, workflow generation, ingest) | **missing**: no `server/src/modules/ci/`, not registered in `modules/index.ts`; only comments in the runner and contracts refer to it | `[new: deterministic: ci module]` |
| Routes: export (`POST /agents/:id/export-ci`), preview, zip, agent CI view, CI runs list, sync | missing | `[new: deterministic: ci module routes]` |
| Tables `ci_installations`, `ci_runs` | exist but minimal (no workflow version, repo id, PR URL, exported paths, run id, commit SHA, reason, verdict, agent run link) | `[reused: server/src/db/schema/ci.ts]` + `[new: columns via pnpm db:generate]` |
| `agent_runs.source` (`local` \| `ci`) | exists | `[reused: server/src/db/schema/runs.ts]` |
| `agents.ci_fail_on` and its editor control in the Config tab | exist | `[reused: schema/agents.ts, ConfigTab]` |
| GitHub write: `commitFiles` (one commit, create or force-update branch), `openPullRequest`, `findOpenPr` | exist on the `GitHubClient` port, Octokit adapter and mock; `commitFiles` cannot delete files (not needed) | `[reused: server/src/adapters/github/octokit.ts]` |
| GitHub read of Actions runs, artifacts and repository id | missing | `[new: deterministic: GitHub Actions source for the ci module]` |
| Zip read/write | `adm-zip` already used for skill import | `[reused: server dependency]` |
| Studio token permissions | the configured token lacks the `workflow` scope today | `[deterministic: GitHub API error mapping]` (AC-42) |
| UI scaffold `ExportWizardSteps` | exists (vendored, unused) | `[reused: client/src/vendor/ui/ExportWizardSteps.tsx]` |
| UI scaffold `AutoTriggerStatus` | exists but is the "Auto-review: ON, polling" pill for local polling; not a fit for CI | not used (A-14) |
| Accessible dialog pattern | `EvalDialog` (role, Escape, focus trap) | `[reused: client/src/components/evals/EvalDialog]` or the same pattern |
| Agent editor CI tab | missing (tabs today: config, skills, evals, context) | `[new]` |
| CI Runs page and sidebar item | missing; only `activeKeyFor` knows `/ci-runs` | `[new]`; nav item in `client/src/vendor/ui/nav.ts` (shared) |
| Memory entries for `memory.jsonl` | `memory` table exists | `[reused: schema/knowledge.ts]`, export `[new: deterministic]` |
| Finding attribution from worktree A | not in this branch | read after A merges; CI ingest stores run-level agent attribution only (A-7) |
| LLM calls added by this feature | none in the studio. The review in CI is the existing runner call (one or more LLM calls per PR, billed to the repository's OpenRouter key) | `[reused: reviewer-core via agent-runner]` |

Every fact this feature shows (files, workflow, verdict, counts, costs, statuses) is computed by code. No model summarizes or decides anything in the studio.

## Untrusted inputs

Text from the target repository or its PRs that reaches a model, a shell, the studio database or the UI:

| Input | Where it goes | Handling |
|---|---|---|
| PR diff | Model in CI | Wrapped by `assemblePrompt` / `wrapUntrusted` with `INJECTION_GUARD` as delimited data; cannot change policy, gate or verdict (verdict is deterministic). |
| PR title and body | Model in CI; PR title also to the studio UI via the run's display title | Model: same delimited data with the injection guard. Shell: never interpolated into `run:` (AC-25). UI: plain text only (AC-80). |
| Branch names (head ref) | Not used by the workflow or the runner | Never interpolated anywhere (AC-25). |
| PR and review comments | Not read by the runner | Never turned into commands, triggers or instructions; no `issue_comment` trigger (AC-21). |
| `.devdigest/agents/*.yaml`, `.devdigest/skills/*.md` at the base commit | Runner config and prompt | Manifest schema-validated before use; skill bodies are the agent's own prompt content, read from the base commit only (AC-22), so a PR cannot change them for its own review. |
| `devdigest-result.json` | Studio ingest | Size limits, single-entry archive, schema validation with unknown keys stripped, cross-check with GitHub run metadata (AC-58 to AC-61). String fields stored as data, rendered as plain text. |
| GitHub run metadata (display title, URLs) | Studio UI | Plain text; links only to `https://github.com/` URLs (AC-80). |
| User-edited workflow YAML | Committed to the target repository | Validated against the security rules before commit (AC-29). |

All model-bound repository and PR text is passed as delimited data with the injection guard and cannot change policy.

## Open questions

All resolved by default as the user asked (simplest viable option), except A-15. Each can be revisited after review.

- **OQ-1 (resolved by default).** The lab names `specs/export-to-ci.md`; the file is `specs/05-export-to-ci.md`. A symlink `specs/export-to-ci.md -> 05-export-to-ci.md` (as done for `eval-pipeline.md`) can be added by the caller; this agent writes only the spec.
- **A-1.** Only GitHub Actions is shown in Target; other targets are not shown at all (not even disabled), because no generators exist.
- **A-2.** The repository is chosen from repositories already connected in the studio (gives owner, name, default branch); no free-text repository input.
- **A-3.** Only OpenRouter agents can be exported, because the runner always builds an `OpenRouterProvider`.
- **A-4.** One agent per repository; a second agent is refused (409) rather than supported.
- **A-5.** The workflow checks out the PR base commit, so manifest, skills and runner come from the default branch, and the PR's own code is never executed. Consequence: changes to `.devdigest/**` in a PR take effect only after merge.
- **A-6.** Ingest is a studio-initiated pull of GitHub Actions artifacts through the GitHub API with the studio token (the "other verified channel" the lab allows). No inbound endpoint, no shared HMAC secret.
- **A-7.** CI ingest stores counts, verdict and metadata, not individual findings (the artifact has no finding list). Attribution is at run level (`agent_runs.agent_id`, `source = 'ci'`). After worktree A merges, B only checks that its `agent_runs` writes satisfy A's attribution columns (for example a null multi-run parent); no per-finding attribution is read in this version.
- **A-8.** Sync runs on opening the CI Runs page or the CI tab and on "Refresh"; no background polling, no "auto-refresh on" indicator, no filters, no pagination (100 rows), at most 30 runs per installation per sync, no "running" status.
- **A-9.** Only the workflow file is editable in Preview; edits are kept only for that wizard session.
- **A-10.** `memory.jsonl` exports repository-scoped memory entries (`kind`, `scope`, `content`) and is not read by the runner yet.
- **A-11.** CI run metadata (agent version, model, runner version, workflow version, commit SHA) is stored on the `ci_runs` row, which serves as the CI run's trace; no `run_traces` document is written, so the Run Trace drawer is unchanged.
- **A-12.** Fork PRs are skipped by a job-level condition instead of a degraded read-only mode.
- **A-13.** The install PR's own run (no runner on the base yet) shows as a failed run with the "No result artifact" reason; it is not hidden.
- **A-14.** `AutoTriggerStatus` is not used; it represents local polling, not CI. `LiveLogStream` is not used (CI logs live on GitHub).
- **A-15.** (resolved by default) On re-export the studio refuses with `ci_slug_changed` when the agent slug changed and leaves stale skill files in place (harmless: the runner reads only skills listed in the manifest). No file deletion in the commit is needed (AC-91).
- **A-16.** The `devdigest/ci` branch is force-updated by every export (existing `commitFiles` behavior).
- **A-17.** "Fail CI on" in the CI tab edits the agent's existing `ci_fail_on`; it reaches CI only after "Update CI config" and merging the new PR (AC-85 shows the drift).
- **A-18.** The pinned action SHAs are constants in the generator. Choosing the exact versions and SHAs is an implementation task; the AC only requires full 40-character SHAs.

Items for the caller:

- **Research (optional, via `researcher`):** the exact GitHub error bodies and status codes for (a) a tree/ref write that touches `.github/workflows/` without the `workflow` scope, for classic and fine-grained tokens, and (b) Actions artifact download without Actions read access, so AC-42 and AC-69 map them reliably.
- **Lab claim mismatch:** the lab lists the `ci/` module (manifest serialization, workflow generation, ingest) as ready infrastructure, but it does not exist in this branch. Check `upstream/lesson-7-lab/*` for a `server/src/modules/ci` directory before planning; if it exists there, reuse it and re-run this provenance check.

## Ownership and merge order

### Owned by worktree B (Export to CI)

- `server/src/modules/ci/**` (new module: bundle generation, workflow generation and safety checks, export, sync and ingest, routes, tests) and its one registration line in `server/src/modules/index.ts`.
- GitHub Actions read access used by the ci module (a ci-local source/adapter; additive only if the shared `GitHubClient` port must change).
- `server/src/db/schema/ci.ts` and the migration generated from it.
- `agent-runner/**` (artifact fields, reading `GITHUB_REPOSITORY_ID` and the PR head SHA, tests).
- The "Export-to-CI + CI Runs" section of both copies of `contracts/eval-ci.ts` (`server/src/vendor/shared/` and `client/src/vendor/shared/`), additive and kept identical.
- Client: `client/src/app/ci-runs/**`, the agent editor CI tab (`client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/**` and its entry in the editor's `constants.ts`), the export wizard component, CI hooks in `client/src/lib/hooks/`, new message files for CI.

### Not touched by worktree B

- The multi-run service, `POST /pulls/:id/review`, `run-executor`, `multi_agent_runs`, the PR page, the PR feed and the Multi-Agent Review screens (worktree A).
- `server/src/db/schema/runs.ts` (B writes `agent_runs` rows through it but does not change it).
- `reviewer-core/` (consumed as is).
- This repository's `.github/workflows/`.

### Shared points

- `client/src/vendor/ui/nav.ts` (sidebar): B adds one "CI Runs" item; A may add its own. Checked separately after the first merge.
- `server/src/modules/index.ts`: one import and one entry per worktree.
- `client/src/vendor/shared/contracts/eval-ci.ts` and the server copy: B edits only the CI section; A must not edit it. Any change A needs there is agreed before start.
- Drizzle migrations: both worktrees may generate a migration with the same number. B regenerates its own (unmerged) migration after rebasing on A, with `pnpm db:generate`; merged migrations are never edited or renumbered.
- Local environment: B uses its own Postgres database and its own server and web ports, not those of worktree A.

### Merge order

1. Worktree A (Multi-Agent Review) merges first; it adds the finding attribution that B's ingest must stay compatible with.
2. Rebase worktree B on the new base, resolve only expected conflicts (nav, module registry, migration number), re-check that `agent_runs` writes from ingest satisfy A's attribution columns, and re-run all verification commands.
3. Merge worktree B, then run the full product check and verify the sidebar shows both features.

### Verification commands (worktree B)

- `server/`: `pnpm typecheck` and `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- `client/`: `pnpm typecheck` and `pnpm test`
- `agent-runner/`: `pnpm typecheck` and `pnpm test`
- Boundary check: `git -C ../dev-digest-wt-export-ci diff --name-only` against worktree A's list; overlap only in the shared points above.
- Manual lab flow (not automated): export to the demo fork, review and merge the PR, add the secret, open a test PR in the same repository, see the agent's review, see the check go red with "Fail CI on: Critical" and a critical finding (after marking the check required), confirm no secret in logs and artifact, and see the run in CI Runs with a working "View job" link.
