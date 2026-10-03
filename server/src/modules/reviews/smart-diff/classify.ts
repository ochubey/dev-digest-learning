import type { SmartDiffRole } from '@devdigest/shared';
import { DEFAULT_ROLE, ROLE_RULES } from './constants.js';

/**
 * Classify a changed file by path alone. Pure: no IO, no model call. First
 * matching rule in ROLE_RULES wins, otherwise `core`.
 */
export function classifyFile(path: string): SmartDiffRole {
  const p = path.replace(/\\/g, '/').toLowerCase();
  for (const rule of ROLE_RULES) {
    if (rule.patterns.some((re) => re.test(p))) return rule.role;
  }
  return DEFAULT_ROLE;
}
