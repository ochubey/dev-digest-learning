import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import { EvalRun, EvalOwnerKind, Conformance, Provider, CiFailOn } from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.unknown(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  pass_rate: z.number(),
  cost_usd: z.number().nullable(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  current: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunRecord),
  alert: z.string().nullable(),
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ==== SPEC-05 export to CI: begin ====
// Export-to-CI + CI Runs. Must stay byte-identical in the server and client
// vendored copies of this file. Uses only `z`, `Provider` and `CiFailOn`.

export const CI_WORKFLOW_VERSION = 1;
export const CI_RUNNER_VERSION = '2';
export const CI_BRANCH = 'devdigest/ci';
/** The LEGACY single-agent workflow path (installations created before one workflow per agent). New ones use `.github/workflows/devdigest-review-<slug>.yml`. */
export const CI_WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';
export const CI_RESULT_ARTIFACT_NAME = 'devdigest-result';
export const CI_TRIGGERS = ['opened', 'synchronize', 'reopened'] as const;

export const CiTrigger = z.enum(CI_TRIGGERS);
export type CiTrigger = z.infer<typeof CiTrigger>;

export const CiPostAs = z.enum(['github_review', 'pr_comment', 'none']);
export type CiPostAs = z.infer<typeof CiPostAs>;

export const CiVerdict = z.enum(['APPROVE', 'COMMENT', 'REQUEST_CHANGES']);
export type CiVerdict = z.infer<typeof CiVerdict>;

export const CiErrorCode = z.enum([
  'ci_provider_unsupported',
  'ci_repo_not_connected',
  'ci_runner_missing',
  'ci_workflow_unsafe',
  'ci_slug_changed',
  'ci_triggers_invalid',
  'github_workflow_scope_missing',
  'github_write_denied',
  'github_error',
  'github_actions_read_denied',
]);
export type CiErrorCode = z.infer<typeof CiErrorCode>;

export const CiWorkflowRule = z.enum([
  'yaml_invalid',
  'permissions_widened',
  'forbidden_trigger',
  'fork_guard_missing',
  'base_checkout_missing',
  'action_not_pinned',
  'expression_in_run',
  'secret_misassigned',
]);
export type CiWorkflowRule = z.infer<typeof CiWorkflowRule>;

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
  /** Set on preview entries whose contents are emptied (the runner bundle). */
  size_bytes: z.number().int().nullish(),
});
export type CiFile = z.infer<typeof CiFile>;

/**
 * AgentManifest — the agent contract shared by the studio and the CI runner.
 *
 * The studio WRITES this shape to `.devdigest/agents/<slug>.yaml`; the
 * agent-runner READS it. Keeping one Zod schema for both ends guarantees the
 * formats never drift. `skills` are slugs resolved to `.devdigest/skills/<slug>.md`.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  provider: Provider.default('openrouter'),
  model: z.string().min(1),
  system_prompt: z.string(),
  // Tolerate both a missing key and an explicit `null` (YAML `skills:` with no
  // value parses to null, which `.default([])` does NOT catch) — normalize both
  // to an empty array so manifests without skills validate cleanly.
  skills: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  strategy: z.enum(['auto', 'single-pass', 'map-reduce']).default('auto'),
  // CI gate policy (see CiFailOn) — when the posted review should BLOCK
  // (REQUEST_CHANGES + fail the check) vs just comment. Default: block on critical.
  ci_fail_on: CiFailOn.default('critical'),
  /** The agent version at export time. */
  version: z.number().int().positive().optional(),
});
export type AgentManifest = z.infer<typeof AgentManifest>;
/** Caller-facing input type — `.default()` fields stay optional. */
export type AgentManifestInput = z.input<typeof AgentManifest>;

/** Request body for `POST /agents/:id/export-ci` (and `/preview`). */
export const CiExportInput = z.object({
  /** The connected repo's `full_name` ("owner/name"). */
  repo: z.string().min(1),
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" returns a zip download. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: CiPostAs.default('github_review'),
  /** Validated by the service (non-empty subset of CI_TRIGGERS), which answers 400. */
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  /** Kept for compatibility; ignored — the server uses the repo's default branch. */
  base: z.string().default('main'),
  /** The user-edited workflow text; safety-checked by the server. */
  workflow: z.string().max(65_536).nullish(),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
  repo_id: z.string().nullish(),
  github_repo_id: z.number().nullish(),
  slug: z.string().nullish(),
  workflow_version: z.number().int().nullish(),
  agent_version: z.number().int().nullish(),
  ci_fail_on: z.string().nullish(),
  post_as: z.string().nullish(),
  triggers: z.array(z.string()).nullish(),
  files: z.array(z.string()).nullish(),
  pr_url: z.string().nullish(),
  updated_at: z.string().nullish(),
  config_changed: z.boolean().nullish(),
  last_run: z
    .object({ status: z.string().nullable(), ran_at: z.string().nullable() })
    .nullable()
    .nullish(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  /** The runner entry carries empty `contents` and `size_bytes`. */
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
  zip_base64: z.string().nullish(),
  zip_filename: z.string().nullish(),
});
export type CiExport = z.infer<typeof CiExport>;

/** Response of `POST /agents/:id/export-ci/preview`. */
export const CiPreview = z.object({
  files: z.array(CiFile),
  slug: z.string(),
  workflow_version: z.number().int(),
  runner_version: z.string(),
});
export type CiPreview = z.infer<typeof CiPreview>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
  github_run_id: z.number().nullish(),
  repo: z.string().nullish(),
  pr_title: z.string().nullish(),
  commit_sha: z.string().nullish(),
  verdict: z.string().nullish(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  duration_ms: z.number().int().nullish(),
  model: z.string().nullish(),
  agent_version: z.number().int().nullish(),
  runner_version: z.string().nullish(),
  workflow_version: z.number().int().nullish(),
  reason: z.string().nullish(),
  agent_id: z.string().nullish(),
  agent_run_id: z.string().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/** Response of `GET /agents/:id/ci`. */
export const CiAgentView = z.object({
  installations: z.array(CiInstallation),
  runs: z.array(CiRun),
});
export type CiAgentView = z.infer<typeof CiAgentView>;

/** Response of `GET /ci/runs`. */
export const CiRunsList = z.object({
  runs: z.array(CiRun),
  installations_count: z.number().int(),
});
export type CiRunsList = z.infer<typeof CiRunsList>;

export const CiSyncFailure = z.object({
  repo: z.string(),
  code: z.string(),
  message: z.string(),
});
export type CiSyncFailure = z.infer<typeof CiSyncFailure>;

/** Response of `POST /ci/sync`. */
export const CiSyncResult = z.object({
  synced_at: z.string(),
  seen: z.number().int(),
  ingested: z.number().int(),
  rejected: z.number().int(),
  failures: z.array(CiSyncFailure),
});
export type CiSyncResult = z.infer<typeof CiSyncResult>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on sync to populate `ci_runs`. Unknown keys are stripped.
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
  commit_sha: z.string().nullish(),
  repository_id: z.number().int().nullish(),
  model: z.string().nullish(),
  agent_version: z.number().int().nullish(),
  verdict: CiVerdict.nullish(),
  blockers: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;
/** Whether the OpenRouter secret exists in the repo's Actions secrets (the value is never read). */
export const CiSecretState = z.enum(['set', 'not_set', 'unknown']);
export type CiSecretState = z.infer<typeof CiSecretState>;

export const CiSecretStatus = z.object({ OPENROUTER_API_KEY: CiSecretState });
export type CiSecretStatus = z.infer<typeof CiSecretStatus>;

// ==== SPEC-05 export to CI: end ====

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;

// ==== SPEC-03 eval pipeline: begin ====
// Additive block (SPEC-03 OQ-2). Must stay byte-identical in the server and
// client vendored copies of this file. Imports nothing beyond `z`.

export const EVAL_MAX_CASES_PER_RUN = 50;
export const EVAL_RUN_CONCURRENCY = 3;
export const EVAL_CASE_TIMEOUT_MS = 120_000;
export const EVAL_FRAGMENT_MAX_BYTES = 32_768;
export const EVAL_CASE_NAME_MAX = 80;

export const EvalExpectationKind = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectationKind = z.infer<typeof EvalExpectationKind>;

export const EvalCaseOrigin = z.enum(['accepted_finding', 'dismissed_finding', 'seeded']);
export type EvalCaseOrigin = z.infer<typeof EvalCaseOrigin>;

export const EvalSuiteRunStatus = z.enum(['running', 'completed', 'completed_with_errors', 'failed']);
export type EvalSuiteRunStatus = z.infer<typeof EvalSuiteRunStatus>;

export const EvalCaseResultStatus = z.enum(['pending', 'ok', 'error']);
export type EvalCaseResultStatus = z.infer<typeof EvalCaseResultStatus>;

export const EvalFindingMatch = z.enum(['tp', 'fp_zone', 'unlabeled']);
export type EvalFindingMatch = z.infer<typeof EvalFindingMatch>;

export const EvalExpectation = z.object({
  kind: EvalExpectationKind,
  file: z.string(),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
});
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/** Stored in `eval_cases.input_meta`. */
export const EvalCaseMeta = z.object({
  origin: EvalCaseOrigin,
  source_finding_id: z.string().nullish(),
  source_pr_id: z.string().nullish(),
  source_decision: z.enum(['accepted', 'dismissed']).nullish(),
  seed_key: z.string().nullish(),
});
export type EvalCaseMeta = z.infer<typeof EvalCaseMeta>;

export const EvalCaseDraft = z.object({
  finding_id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  origin: EvalCaseOrigin,
  existing_cases: z.array(z.object({ agent_id: z.string(), case_id: z.string() })),
});
export type EvalCaseDraft = z.infer<typeof EvalCaseDraft>;

/** Request body for creating a case from a finding; the service validates and answers 400. */
export const EvalCaseCreateInput = z.object({
  agent_id: z.string(),
  finding_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  notes: z.string().nullish(),
});
export type EvalCaseCreateInput = z.infer<typeof EvalCaseCreateInput>;

export const EvalCaseLastResult = z.object({
  run_id: z.string(),
  status: z.enum(['pass', 'fail', 'error']),
  matched: z.number().int(),
  kind: EvalExpectationKind,
  error: z.string().nullable(),
});
export type EvalCaseLastResult = z.infer<typeof EvalCaseLastResult>;

export const EvalCaseView = z.object({
  id: z.string(),
  agent_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  notes: z.string().nullable(),
  origin: EvalCaseOrigin,
  source_finding_id: z.string().nullable(),
  source_pr_id: z.string().nullable(),
  last_result: EvalCaseLastResult.nullable(),
});
export type EvalCaseView = z.infer<typeof EvalCaseView>;

export const EvalRunManifest = z.object({
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  strategy: z.enum(['single-pass', 'map-reduce', 'auto']),
  ci_fail_on: z.string(),
  repo_intel: z.boolean(),
  skills: z.array(z.string()),
  skill_versions: z.array(z.object({ id: z.string(), name: z.string(), version: z.number().int() })),
});
export type EvalRunManifest = z.infer<typeof EvalRunManifest>;

export const EvalRunCounts = z.object({
  cases_scored: z.number().int(),
  cases_passed: z.number().int(),
  must_find_total: z.number().int(),
  must_find_hit: z.number().int(),
  must_not_flag_total: z.number().int(),
  must_not_flag_violated: z.number().int(),
  tp: z.number().int(),
  fp_zone: z.number().int(),
  fp_unlabeled: z.number().int(),
  grounded: z.number().int(),
  dropped: z.number().int(),
  cases_errored: z.number().int(),
});
export type EvalRunCounts = z.infer<typeof EvalRunCounts>;

export const EvalRunMetrics = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
});
export type EvalRunMetrics = z.infer<typeof EvalRunMetrics>;

export const EvalSuiteRun = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().nullish(),
  agent_version: z.number().int(),
  /** Model the run used (from the run manifest); can differ from the agent's current model. */
  model: z.string().nullish(),
  status: EvalSuiteRunStatus,
  error: z.string().nullable(),
  cases_total: z.number().int(),
  cases_done: z.number().int(),
  metrics: EvalRunMetrics,
  counts: EvalRunCounts.nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type EvalSuiteRun = z.infer<typeof EvalSuiteRun>;

export const EvalResultFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  severity: z.enum(['CRITICAL', 'WARNING', 'SUGGESTION']),
  category: z.enum(['bug', 'security', 'perf', 'style', 'test']),
  title: z.string(),
  match: EvalFindingMatch,
});
export type EvalResultFinding = z.infer<typeof EvalResultFinding>;

export const EvalDroppedFinding = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  title: z.string(),
  reason: z.string(),
});
export type EvalDroppedFinding = z.infer<typeof EvalDroppedFinding>;

export const EvalCaseResult = z.object({
  id: z.string(),
  case_id: z.string().nullable(),
  case_name: z.string(),
  expectation: EvalExpectation,
  origin: EvalCaseOrigin,
  status: EvalCaseResultStatus,
  pass: z.boolean().nullable(),
  grounded: z.array(EvalResultFinding),
  dropped: z.array(EvalDroppedFinding),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  error: z.string().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

export const EvalSuiteRunDetail = EvalSuiteRun.extend({
  manifest: EvalRunManifest,
  results: z.array(EvalCaseResult),
});
export type EvalSuiteRunDetail = z.infer<typeof EvalSuiteRunDetail>;

export const EvalRunStartResponse = z.object({ run_id: z.string() });
export type EvalRunStartResponse = z.infer<typeof EvalRunStartResponse>;

/** Optional body of the run start: use another model of the agent's provider for this run only. */
export const EvalRunStartInput = z.object({ model: z.string().min(1).max(200).optional() });
export type EvalRunStartInput = z.infer<typeof EvalRunStartInput>;

export const EvalRunPage = z.object({
  items: z.array(EvalSuiteRun),
  next_cursor: z.string().nullable(),
});
export type EvalRunPage = z.infer<typeof EvalRunPage>;

export const EvalOverview = z.object({
  agents: z.array(
    z.object({
      agent_id: z.string(),
      name: z.string(),
      model: z.string(),
      version: z.number().int(),
      latest: EvalSuiteRun.nullable(),
      previous: EvalSuiteRun.nullable(),
    }),
  ),
  recent: z.array(EvalSuiteRun),
});
export type EvalOverview = z.infer<typeof EvalOverview>;

/** `a` is the older run by `started_at`. */
export const EvalCompare = z.object({
  a: EvalSuiteRunDetail,
  b: EvalSuiteRunDetail,
});
export type EvalCompare = z.infer<typeof EvalCompare>;
// ==== SPEC-03 eval pipeline: end ====
