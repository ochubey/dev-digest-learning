import { eq, isNull, or, type SQL } from 'drizzle-orm';
import type { Finding } from '@devdigest/shared';
import * as t from '../../db/schema.js';

/**
 * THE scope-visibility rules for findings (single definition on the server; the
 * client mirrors them in client/src/lib/latest-findings.ts).
 *  - isVisibleScope: not suppressed (`out`); null/undefined (legacy rows) = in.
 *    `signal` IS visible (reported separately). Used by smart-diff `finding_lines`.
 *  - isInScope: null/undefined or `in` only; excludes `signal`. Drives counters
 *    that mean "verdict numbers" (e.g. the PR-list FINDINGS column).
 */
export function isVisibleScope(scope: Finding['scope']): boolean {
  return scope !== 'out';
}

export function isInScope(scope: Finding['scope']): boolean {
  return scope == null || scope === 'in';
}

/** SQL equivalent of `isInScope` over `findings.scope` (NULL or 'in'). */
export function inScopeCondition(): SQL {
  return or(isNull(t.findings.scope), eq(t.findings.scope, 'in')) as SQL;
}
