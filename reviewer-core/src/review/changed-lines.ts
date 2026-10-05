import type { UnifiedDiff } from '@devdigest/shared';
import { buildLineIndex } from '../grounding.js';

/**
 * Per file, the set of NEW-side line numbers covered by the diff's hunks.
 * A deletion-only hunk (newLines = 0) counts its newStart line.
 */
export function changedLines(diff: UnifiedDiff): Map<string, Set<number>> {
  return buildLineIndex(diff);
}
