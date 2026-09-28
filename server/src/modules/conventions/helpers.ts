import type { ConventionCandidate } from '@devdigest/shared';
import type { ConventionRow } from './repository.js';

/**
 * Pure DB row ⇄ DTO mapping for the conventions module. No I/O.
 *
 * `evidence_path` is stored as `<path>` or `<path>:<line>` (no dedicated
 * `evidence_line` column — adding one would require a migration; the schema
 * change was deliberately kept to just `rejected` per the coordinator's prep
 * work, so the line is folded into the existing text column instead).
 */

export function encodeEvidencePath(file: string, line?: number | null): string {
  return line != null ? `${file}:${line}` : file;
}

export function decodeEvidencePath(stored: string | null): {
  path: string | null;
  line: number | null;
} {
  if (!stored) return { path: null, line: null };
  const m = stored.match(/^(.*):(\d+)$/);
  if (m) return { path: m[1]!, line: Number(m[2]) };
  return { path: stored, line: null };
}

export function toConventionDto(row: ConventionRow): ConventionCandidate {
  const { path, line } = decodeEvidencePath(row.evidencePath);
  return {
    id: row.id,
    rule: row.rule,
    category: row.category,
    evidence_path: path,
    evidence_snippet: row.evidenceSnippet,
    evidence_line: line,
    confidence: row.confidence,
    accepted: row.accepted,
    rejected: row.rejected,
  };
}
