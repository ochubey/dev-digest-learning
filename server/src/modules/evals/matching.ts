import type { EvalExpectation } from '@devdigest/shared';

export interface Located {
  file: string;
  start_line: number;
  end_line: number;
}

/** Strips one leading `./`. Comparison stays exact and case-sensitive. */
export function normalizePath(p: string): string {
  return p.startsWith('./') ? p.slice(2) : p;
}

/** Orders a range so that start <= end. */
export function normalizeRange(start: number, end: number): [number, number] {
  return start <= end ? [start, end] : [end, start];
}

/** AC-24: same file and inclusive line ranges overlap. */
export function matches(finding: Located, expectation: Pick<EvalExpectation, 'file' | 'start_line' | 'end_line'>): boolean {
  if (normalizePath(finding.file) !== normalizePath(expectation.file)) return false;
  const [fs, fe] = normalizeRange(finding.start_line, finding.end_line);
  const [es, ee] = normalizeRange(expectation.start_line, expectation.end_line);
  return Math.max(fs, es) <= Math.min(fe, ee);
}
