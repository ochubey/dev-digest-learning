import type { FastifyBaseLogger } from 'fastify';
import type { BriefMissingInput, BriefSection } from '@devdigest/shared';
import { TimeoutError } from '../../platform/resilience.js';
import { ConfigError } from '../../platform/errors.js';
import type { GroundingCounts } from './grounding.js';

/**
 * Run-log text for the brief generation. Counts, ids and fixed strings only: never prompts,
 * documents, PR bodies or provider error text.
 */

export type BriefOutcome =
  | 'ok'
  | 'invalid_output'
  | 'provider_error'
  | 'timeout'
  | 'provider_unavailable'
  | 'input_over_budget';

/**
 * The ONE definition of the `brief=` label. At most one `completeStructured` call is ever
 * made; `schema_attempts` (validation reprompts inside it) is a separate field.
 */
export function briefCallsLabel(o: { calls: 0 | 1; outcome: BriefOutcome }): string {
  return `brief=${o.calls} ${o.outcome}`;
}

export interface BriefLogMeta {
  prId: string;
  outcome: BriefOutcome;
  calls: 0 | 1;
  schemaAttempts?: number | null;
  provider?: string | null;
  model?: string | null;
  estInputTokens?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  truncated: BriefSection[];
  /** Absent when grounding did not run. */
  grounding?: GroundingCounts;
  missing: BriefMissingInput[];
  error_class?: string | null;
  error_message?: string | null;
}

export function briefLogFields(m: BriefLogMeta) {
  return {
    pr_id: m.prId,
    step: 'brief' as const,
    calls: briefCallsLabel({ calls: m.calls, outcome: m.outcome }),
    schema_attempts: m.calls === 0 ? null : (m.schemaAttempts ?? null),
    provider: m.provider ?? null,
    model: m.model ?? null,
    est_input_tokens: m.estInputTokens ?? null,
    tokens_in: m.tokensIn ?? null,
    tokens_out: m.tokensOut ?? null,
    cost_usd: m.costUsd ?? null,
    truncated: m.truncated,
    ...(m.grounding ? { grounding: m.grounding } : {}),
    missing: m.missing,
    outcome: m.outcome,
    error_class: m.error_class ?? null,
    error_message: m.error_message ?? null,
  };
}

/** The only place that writes the brief log line: exactly one per generation, every path. */
export function logBriefGeneration(
  log: Pick<FastifyBaseLogger, 'info'>,
  m: BriefLogMeta,
): void {
  const fields = briefLogFields(m);
  log.info(fields, `brief: ${fields.calls}`);
}

/** Error names that may be echoed into logs/responses; anything else collapses to `Error`. */
const ERROR_CLASS_ALLOW = new Set([
  'Error',
  'TimeoutError',
  'ConfigError',
  'ExternalServiceError',
  'AppError',
  'APIError',
  'RateLimitError',
  'AuthenticationError',
  'APIConnectionError',
]);

const FIXED_MESSAGE: Record<Exclude<BriefOutcome, 'ok' | 'input_over_budget'>, string> = {
  timeout: 'The model call timed out',
  invalid_output: 'The model returned output that failed schema validation',
  provider_unavailable: 'The configured provider is not available',
  provider_error: 'The model provider returned an error',
};

export interface ClassifiedLlmError {
  outcome: 'timeout' | 'invalid_output' | 'provider_unavailable' | 'provider_error';
  error_class: string;
  error_message: string;
}

/**
 * Maps a failed model call to an outcome. `err.message` is read for classification only and
 * `err.details` never: both can echo prompts, document text or credentials. The returned
 * message is a fixed per-outcome string plus the HTTP status when it is numeric.
 */
export function classifyLlmError(err: unknown): ClassifiedLlmError {
  const e = (err && typeof err === 'object' ? err : {}) as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
  };
  // AppError subclasses all set `name = 'AppError'`; the constructor name tells them apart.
  const ctorName = err instanceof Error ? err.constructor?.name : undefined;
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const candidate = ctorName && ERROR_CLASS_ALLOW.has(ctorName) ? ctorName : name;
  const error_class = ERROR_CLASS_ALLOW.has(candidate) ? candidate : 'Error';
  const message = typeof e.message === 'string' ? e.message : '';

  let outcome: ClassifiedLlmError['outcome'];
  if (err instanceof TimeoutError || name === 'TimeoutError') outcome = 'timeout';
  else if (/structured output failed schema validation/.test(message)) outcome = 'invalid_output';
  else if (err instanceof ConfigError) outcome = 'provider_unavailable';
  else outcome = 'provider_error';

  const status =
    typeof e.status === 'number' && Number.isFinite(e.status) ? ` (HTTP ${e.status})` : '';
  return { outcome, error_class, error_message: `${FIXED_MESSAGE[outcome]}${status}` };
}
