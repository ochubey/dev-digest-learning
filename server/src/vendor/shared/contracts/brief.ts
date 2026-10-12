import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const IntentSource = z.object({
  label: z.string(),
  status: z.enum(['fetched', 'unavailable', 'error']),
});
export type IntentSource = z.infer<typeof IntentSource>;

export const Intent = z.object({
  summary: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  sources: z.array(IntentSource),
  missing_context: z.array(z.string()).optional(),
  // Legacy fields for backward compatibility
  intent: z.string().optional(),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const RiskAnchor = z
  .object({
    file: z.string(),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
  })
  .refine((a) => a.end_line >= a.start_line, 'end_line must be >= start_line');
export type RiskAnchor = z.infer<typeof RiskAnchor>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
  anchor: RiskAnchor.optional(),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
// Risk / Risks are shared, extended only with optional anchor; the ">= 1 file_refs" rule lives in the
// server-only PrBriefStored schema.

export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int().min(1),
  reason: z.string(),
  line_adjusted: z.boolean().optional(), // set only by grounding
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// Enum order IS the canonical order of meta.missing.
export const BriefMissingInput = z.enum([
  'intent',
  'blast',
  'description',
  'linked_issue',
  'specs',
  'diff',
]);
export type BriefMissingInput = z.infer<typeof BriefMissingInput>;

export const BriefSection = z.enum([
  'specs',
  'linked_issue',
  'description',
  'blast_callers',
  'diff_stats',
]);
export type BriefSection = z.infer<typeof BriefSection>;

export const BriefDiffStats = z.object({
  files: z.number().int(),
  additions: z.number().int(),
  deletions: z.number().int(),
  by_role: z.object({
    core: z.number().int(),
    tests: z.number().int(),
    wiring: z.number().int(),
    docs: z.number().int(),
    boilerplate: z.number().int(),
  }),
});
export type BriefDiffStats = z.infer<typeof BriefDiffStats>;

export const BriefMeta = z.object({
  generated_from_head_sha: z.string(),
  generated_at: z.string().datetime(), // ISO-8601 UTC, 'Z' only, no offset
  provider: z.string(),
  model: z.string(),
  schema_attempts: z.number().int().min(1),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  missing: z.array(BriefMissingInput).refine(
    (a) =>
      a.every(
        (v, i) =>
          i === 0 ||
          BriefMissingInput.options.indexOf(a[i - 1]!) < BriefMissingInput.options.indexOf(v),
      ),
    'missing must be unique and in canonical order',
  ),
  sources: z.array(IntentSource),
  diff_stats: BriefDiffStats.nullable(),
  input: z.object({
    estimated_tokens: z.number().int(),
    budget_tokens: z.number().int(),
    truncated: z.array(BriefSection),
    blast_degraded_reason: z.string().nullable(),
  }),
  grounding: z.object({
    dropped_risks: z.number().int(),
    dropped_refs: z.number().int(),
    dropped_focus: z.number().int(),
    adjusted_lines: z.number().int(),
    dropped_anchors: z.number().int().min(0).default(0),
  }),
});
export type BriefMeta = z.infer<typeof BriefMeta>;

export const PrBrief = z.object({
  summary: z.string(),
  intent: Intent.nullable(),
  blast: BlastRadius.nullable(),
  risks: Risks,
  review_focus: z.array(ReviewFocusItem),
  history: PrHistory.optional(),
  meta: BriefMeta,
});
export type PrBrief = z.infer<typeof PrBrief>;
