import { z } from 'zod';
import { Provider } from './knowledge.js';
import { Severity } from './findings.js';

/**
 * Platform / scaffolding DTOs owned by F1:
 *  - settings (GET/PUT /settings, POST /settings/test-connection)
 *  - repos (POST/GET /repos, refresh, delete)
 *  - pulls (GET /repos/:id/pulls, GET /pulls/:id)
 *  - context (Project Context folder)
 */

// ---- Feature → model selection ----
/** System LLM features whose model is selectable in Settings (per-workspace). */
export const FeatureModelId = z.enum([
  'onboarding',
  'standard',
  'risk_brief',
  'conformance',
  'eval_reference',
  'conventions',
  'memory_learning',
  /** Legacy: the old Intent slot, replaced by `standard`. Not in the registry; only read as a fallback. */
  'review_intent',
]);
export type FeatureModelId = z.infer<typeof FeatureModelId>;

/** A chosen provider + model for one feature. */
export const FeatureModelChoice = z.object({
  provider: Provider,
  model: z.string().min(1),
});
export type FeatureModelChoice = z.infer<typeof FeatureModelChoice>;

/**
 * Registry of the selectable features: stable id, display label, and the
 * built-in default used when the workspace hasn't overridden the choice. The
 * defaults MIRROR each module's constants, so behaviour is unchanged until a
 * model is explicitly picked.
 */
export interface FeatureModelDef {
  id: FeatureModelId;
  label: string;
  description: string;
  defaultProvider: Provider;
  defaultModel: string;
}
export const FEATURE_MODELS: FeatureModelDef[] = [
  {
    id: 'onboarding',
    label: 'Onboarding Tour',
    description: 'Writes the per-repo onboarding tour.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'standard',
    label: 'Standard Model',
    description: 'Used for: Intent, Multi-agent review Aggregate, and Blast radius summary.',
    defaultProvider: 'openrouter',
    defaultModel: 'google/gemini-2.5-flash-lite',
  },
  {
    id: 'risk_brief',
    label: 'Risk Brief',
    description: 'Assesses merge risks for a pull request.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'conformance',
    label: 'Conformance',
    description: 'Checks a PR against the project spec.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-4.1',
  },
  {
    id: 'eval_reference',
    label: 'Eval Reference Agent',
    description: 'Runs skill eval cases with/without the skill attached.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
  {
    id: 'conventions',
    label: 'Conventions',
    description: 'Extracts coding conventions from the repo.',
    defaultProvider: 'openai',
    defaultModel: 'gpt-5.4',
  },
  {
    id: 'memory_learning',
    label: 'Memory · Learning',
    description: 'Learns reusable memory from review activity.',
    defaultProvider: 'openrouter',
    defaultModel: 'deepseek/deepseek-v4-flash',
  },
];

// ---- Settings ----
/**
 * Non-secret prefs/config. Secrets (API keys) are NOT stored here — they go
 * through SecretsProvider (.env in MVP). Settings is a flat key/value bag,
 * surfaced as a typed object for the well-known keys.
 */
export const SettingsKnown = z.object({
  polling_interval_min: z.number().int().min(1).default(5),
  theme: z.enum(['dark', 'light']).default('dark'),
  density: z.enum(['regular', 'compact']).default('regular'),
  sync_to_folder: z.boolean().default(true),
  automatic_reviews: z.boolean().default(false),
  /** Per-feature model overrides (provider+model), keyed by FeatureModelId. */
  feature_models: z.record(FeatureModelId, FeatureModelChoice).default({}),
});
export type SettingsKnown = z.infer<typeof SettingsKnown>;

/** Full settings payload: well-known keys + arbitrary extras. */
export const Settings = SettingsKnown.passthrough();
export type Settings = z.infer<typeof Settings>;

export const SettingsUpdate = Settings.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

// ---- Connection test ----
export const ConnTestProvider = z.enum(['openai', 'anthropic', 'openrouter', 'github']);
export type ConnTestProvider = z.infer<typeof ConnTestProvider>;

export const ConnTestRequest = z.object({
  provider: ConnTestProvider,
  /** Optional API key/PAT to persist and then test (BYO key from the UI). */
  key: z.string().min(1).optional(),
});
export type ConnTestRequest = z.infer<typeof ConnTestRequest>;

export const ConnTestResult = z.object({
  provider: ConnTestProvider,
  ok: z.boolean(),
  message: z.string(),
  detail: z.unknown().optional(),
});
export type ConnTestResult = z.infer<typeof ConnTestResult>;

// ---- Secrets status (which provider keys are configured; never the values) ----
/** Boolean per provider: true ⇒ a key/PAT is stored. The value is never exposed. */
export const SecretsStatus = z.object({
  openai: z.boolean(),
  anthropic: z.boolean(),
  openrouter: z.boolean(),
  github: z.boolean(),
});
export type SecretsStatus = z.infer<typeof SecretsStatus>;

// ---- Repos ----
export const RepoInput = z.object({
  url: z.string().url(),
});
export type RepoInput = z.infer<typeof RepoInput>;

export const Repo = z.object({
  id: z.string(),
  workspace_id: z.string(),
  owner: z.string(),
  name: z.string(),
  full_name: z.string(),
  default_branch: z.string(),
  clone_path: z.string().nullable(),
  last_polled_at: z.string().nullable(),
  created_by: z.string().nullable(),
});
export type Repo = z.infer<typeof Repo>;

// ---- Pull requests ----
export const PrStatus = z.enum(['needs_review', 'reviewed', 'stale', 'open', 'closed', 'merged']);
export type PrStatus = z.infer<typeof PrStatus>;

/** Lightweight, read-only finding preview for the PR-list FINDINGS popover — no rationale/suggestion (that's the PR detail page). */
export const FindingPreview = z.object({
  severity: Severity,
  title: z.string(),
  category: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  confidence: z.number(),
});
export type FindingPreview = z.infer<typeof FindingPreview>;

export const PrMeta = z.object({
  id: z.string().nullish(),
  number: z.number().int(),
  title: z.string(),
  author: z.string(),
  branch: z.string(),
  base: z.string(),
  head_sha: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  files_count: z.number().int(),
  status: PrStatus,
  opened_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  // Latest-review score (list endpoint only; null/absent until reviewed).
  score: z.number().int().nullish(),
  // SUM of every successful run's USD cost for this PR (list endpoint only; null/absent until any run completes).
  cost_usd: z.number().nullish(),
  // Latest review's findings, for the FINDINGS column's hover popover (list endpoint only; null/absent until reviewed).
  findings: z
    .object({
      severity_counts: z.object({ CRITICAL: z.number().int(), WARNING: z.number().int(), SUGGESTION: z.number().int() }),
      items: z.array(FindingPreview),
    })
    .nullish(),
});
export type PrMeta = z.infer<typeof PrMeta>;

export const PrFile = z.object({
  path: z.string(),
  additions: z.number().int(),
  deletions: z.number().int(),
  patch: z.string().nullish(),
});
export type PrFile = z.infer<typeof PrFile>;

export const PrCommit = z.object({
  sha: z.string(),
  message: z.string(),
  author: z.string(),
  committed_at: z.string().nullish(),
});
export type PrCommit = z.infer<typeof PrCommit>;

export const IssueMeta = z.object({
  number: z.number().int(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
});
export type IssueMeta = z.infer<typeof IssueMeta>;

export const PrDetail = PrMeta.extend({
  body: z.string().nullish(),
  files: z.array(PrFile),
  commits: z.array(PrCommit),
  linked_issue: IssueMeta.nullish(),
});
export type PrDetail = z.infer<typeof PrDetail>;

// ---- PR review (inline) comments ----
/**
 * A GitHub PR review comment anchored to a diff line. Mirrors the fields the
 * "Files changed" tab needs to render threads inline; `line` is the position in
 * the current diff (null when GitHub can no longer anchor it → `is_outdated`).
 */
export const PrReviewComment = z.object({
  id: z.number().int(),
  path: z.string(),
  line: z.number().int().nullable(),
  original_line: z.number().int().nullable(),
  side: z.enum(['LEFT', 'RIGHT']),
  body: z.string(),
  user: z.string(),
  created_at: z.string(),
  html_url: z.string(),
  in_reply_to_id: z.number().int().nullable(),
  /** GitHub couldn't anchor it to the current diff (line == null). */
  is_outdated: z.boolean(),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

/** Body for POST /pulls/:id/comments (create one inline comment / reply). */
export const PrCommentInput = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  body: z.string().min(1),
  /** Reply to an existing review comment thread (its comment id). */
  in_reply_to: z.number().int().optional(),
});
export type PrCommentInput = z.infer<typeof PrCommentInput>;

// ---- Project Context ----
export const PROJECT_CONTEXT_FOLDERS = ['specs', 'docs', 'insights'] as const;
/** Above this many attached tokens the UI warns (never blocks). */
export const PROJECT_CONTEXT_SOFT_CAP_TOKENS = 4000;
/** Run-time ceiling: docs past this budget are skipped as `over_budget`. */
export const PROJECT_CONTEXT_HARD_CEILING_TOKENS = 32000;

/** Most documents one agent or skill can attach. */
export const PROJECT_CONTEXT_MAX_ATTACHED = 50;
/** Longest accepted document path, in characters. */
export const PROJECT_CONTEXT_MAX_PATH_LENGTH = 300;

export const ContextSource = z.enum(PROJECT_CONTEXT_FOLDERS);
export type ContextSource = z.infer<typeof ContextSource>;

export const ContextDoc = z.object({
  path: z.string(),
  name: z.string(),
  folder: z.string(),
  source: ContextSource,
  tokens: z.number().int(),
});
export type ContextDoc = z.infer<typeof ContextDoc>;

export const ContextDiscovery = z.object({
  repo_id: z.string(),
  branch: z.string(),
  commit_sha: z.string(),
  docs: z.array(ContextDoc),
});
export type ContextDiscovery = z.infer<typeof ContextDiscovery>;

export const ContextDocPreview = z.object({
  path: z.string(),
  source: ContextSource,
  tokens: z.number().int(),
  used_by: z.number().int(),
  content: z.string(),
  commit_sha: z.string(),
});
export type ContextDocPreview = z.infer<typeof ContextDocPreview>;

export const ContextAttachments = z.object({
  paths: z.array(z.string()),
  version: z.number().int(),
});
export type ContextAttachments = z.infer<typeof ContextAttachments>;

export const InheritedContextDoc = z.object({
  path: z.string(),
  skill_id: z.string(),
  skill_name: z.string(),
});
export type InheritedContextDoc = z.infer<typeof InheritedContextDoc>;

export const AgentContextAttachments = ContextAttachments.extend({
  inherited: z.array(InheritedContextDoc),
});
export type AgentContextAttachments = z.infer<typeof AgentContextAttachments>;

export const ContextAttachmentsInput = z.object({
  paths: z.array(z.string().max(PROJECT_CONTEXT_MAX_PATH_LENGTH)).max(PROJECT_CONTEXT_MAX_ATTACHED),
});
export type ContextAttachmentsInput = z.infer<typeof ContextAttachmentsInput>;

export const DefaultContextRepo = z.object({ repo_id: z.string().nullable() });
export type DefaultContextRepo = z.infer<typeof DefaultContextRepo>;

/** @deprecated Superseded by ContextDoc / ContextDocPreview; kept for legacy callers. */
export const SpecFile = z.object({
  path: z.string(),
  content: z.string().nullish(),
  size: z.number().int().nullish(),
  updated_at: z.string().nullish(),
});
export type SpecFile = z.infer<typeof SpecFile>;

export const IndexStatus = z.object({
  status: z.enum(['idle', 'cloning', 'parsing', 'embedding', 'done', 'error']),
  pct: z.number().min(0).max(100),
  message: z.string().nullish(),
  chunks_indexed: z.number().int().nullish(),
});
export type IndexStatus = z.infer<typeof IndexStatus>;

// ---- Run request (review trigger; owned by A2, contract lives here) ----
export const RunRequest = z.object({
  agentId: z.string().optional(),
  all: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequest>;

// ---- Structured API error envelope (returned by the API; UX taxonomy is FE) ----
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
