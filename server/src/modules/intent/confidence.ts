// Intent confidence ceiling, computed in code from evidence (the model's own number is only a
// self-assessment and used to ignore unavailable sources entirely). Result = min(model, caps).
//
//   empty PR description ............................ 0.4 (0 when no external source was fetched)
//   explicitly referenced plan / spec / ticket that
//     is unavailable (not found or fetch error) ...... 0.5
//   any other unavailable explicit reference
//     (e.g. an issue in another repository) ........... 0.7
//
// Only explicit references have a status (implicit bare #N that do not resolve are dropped by
// the resolver), so every non-fetched status here is something the PR actually pointed at.

import type { SourceStatus } from './ref-resolver.js';

export const CAP_EMPTY_BODY = 0.4;
export const CAP_UNAVAILABLE_EXPLICIT_SOURCE = 0.5;
export const CAP_UNAVAILABLE_OTHER_REF = 0.7;

export interface ConfidenceInput {
  modelConfidence: number;
  /** True when the PR description is empty or whitespace. */
  bodyEmpty: boolean;
  /** Status per referenced source, keyed as in RefResolverResult.sourceStatuses. */
  statuses: Record<string, SourceStatus>;
  /** True when at least one external source (issue / plan / spec) was actually fetched. */
  anyFetched: boolean;
}

export interface ConfidenceResult {
  confidence: number;
  /** ASCII explanations for every cap that lowered (or zeroed) the model value. */
  reasons: string[];
}

function isStrictSourceKey(key: string): boolean {
  return key === 'linked_issue' || key.startsWith('plan_at_') || key.startsWith('spec_at_');
}

export function applyConfidenceCaps(input: ConfidenceInput): ConfidenceResult {
  let confidence = input.modelConfidence;
  const reasons: string[] = [];
  const cap = (limit: number, why: string) => {
    if (confidence > limit) {
      reasons.push(`confidence capped at ${limit.toFixed(1)}: ${why}`);
      confidence = limit;
    }
  };

  if (input.bodyEmpty) {
    if (!input.anyFetched) {
      if (confidence > 0) reasons.push('confidence set to 0: empty description and no fetched source');
      confidence = 0;
    } else {
      cap(CAP_EMPTY_BODY, 'empty description');
    }
  }

  const unavailable = Object.entries(input.statuses).filter(([, st]) => st !== 'fetched');
  const strict = unavailable.filter(([key]) => isStrictSourceKey(key));
  const other = unavailable.filter(([key]) => !isStrictSourceKey(key));
  if (strict.length > 0) {
    cap(CAP_UNAVAILABLE_EXPLICIT_SOURCE, `${strict.length} explicitly referenced plan, spec or ticket unavailable`);
  }
  if (other.length > 0) {
    cap(CAP_UNAVAILABLE_OTHER_REF, `${other.length} other explicit reference(s) unavailable`);
  }

  return { confidence, reasons };
}
