import { asciiSafe } from '../intent/log-lines.js';

/**
 * Run-log text for the project-context step. Counts, paths and fixed reason codes only:
 * never document bodies.
 */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function projectContextSummaryLine(s: {
  injected: number;
  tokens: number;
  skipped: number;
}): string {
  return `project context: ${plural(s.injected, 'doc', 'docs')} injected, ${plural(s.tokens, 'token', 'tokens')}; ${s.skipped} skipped`;
}

export function projectContextSkipLine(path: string, reason: string): string {
  return `project context: skipped ${asciiSafe(path)} (${asciiSafe(reason)})`;
}
