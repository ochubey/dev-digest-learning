import { BriefMissingInput } from '@devdigest/shared';

/** Total input budget (estimated tokens) for the brief prompt, schema included. */
export const BRIEF_BUDGET_TOKENS = 8000;
/** Reserved for instructions, wrappers and the output schema. */
export const BRIEF_FRAMING_RESERVE = 1500;

/** Per-section ceilings (estimated tokens, measured on escaped content). Sections never borrow. */
export const CEILING_INTENT_SUMMARY = 300;
export const CEILING_INTENT_SCOPE = 400;
export const CEILING_BLAST_SUMMARY = 100;
export const CEILING_SPEC_DOC = 800;
export const CEILING_LINKED_ISSUE = 700;
export const CEILING_DESCRIPTION = 1200;
export const CEILING_BLAST_CALLERS = 500;
export const CEILING_DIFF_ROWS = 2500;

export const BRIEF_RATE_LIMIT_MS = 30_000;
export const BRIEF_LLM_TIMEOUT_MS = 50_000;
export const BRIEF_MAX_RETRIES = 1;
/** Adapter-level timeout passed to the model call; the service-level cap is BRIEF_LLM_TIMEOUT_MS. */
export const BRIEF_ADAPTER_TIMEOUT_MS = 45_000;

/** Blast callers listed in the prompt. */
export const MAX_BLAST_CALLERS = 25;

/** Output caps enforced in code (the strict JSON schema carries no length keywords). */
export const MAX_SUMMARY_CHARS = 600;
export const MAX_RISKS = 8;
export const MAX_EXPLANATION_CHARS = 400;
export const MAX_FOCUS_ITEMS = 7;
export const MAX_REASON_CHARS = 200;

export const RISK_KINDS = [
  'security',
  'db_migration',
  'breaking_api',
  'perf',
  'deps',
  'correctness',
  'other',
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export const TRUNCATION_MARKER = '[...truncated]';

/** Canonical order of `meta.missing` (the contract enum order). */
export const BRIEF_MISSING_ORDER: readonly BriefMissingInput[] = BriefMissingInput.options;
