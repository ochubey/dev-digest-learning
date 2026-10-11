import { EvalExpectationKind } from '@devdigest/shared';
import { EVAL_CASE_NAME_MAX, EVAL_FRAGMENT_MAX_BYTES } from './constants.js';
import { inspectFragment } from './fragment.js';

export interface CaseInputLike {
  name?: unknown;
  expectation?: { kind?: unknown; file?: unknown; start_line?: unknown; end_line?: unknown } | null;
  input_diff?: unknown;
}

/** AC-14: returns human-readable reasons; an empty list means valid. */
export function validateCaseInput(input: CaseInputLike): string[] {
  const reasons: string[] = [];
  const e = input.expectation ?? {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) reasons.push('name must not be empty');
  else if (name.length > EVAL_CASE_NAME_MAX) reasons.push(`name must be at most ${EVAL_CASE_NAME_MAX} characters`);
  if (!EvalExpectationKind.safeParse(e.kind).success) reasons.push('kind must be must_find or must_not_flag');

  const start = e.start_line;
  const end = e.end_line;
  const startOk = Number.isInteger(start) && (start as number) >= 1;
  const endOk = Number.isInteger(end) && (end as number) >= 1;
  if (!startOk) reasons.push('start_line must be an integer >= 1');
  else if (!endOk || (end as number) < (start as number)) reasons.push('end_line must be an integer >= start_line');
  const file = typeof e.file === 'string' ? e.file : '';
  if (!file) reasons.push('file must not be empty');

  const diff = typeof input.input_diff === 'string' ? input.input_diff : '';
  if (!diff.trim()) reasons.push('diff fragment must not be empty');
  else if (Buffer.byteLength(diff, 'utf8') > EVAL_FRAGMENT_MAX_BYTES) {
    reasons.push(`diff fragment must be at most ${EVAL_FRAGMENT_MAX_BYTES} bytes`);
  } else if (file && startOk && endOk) {
    const coverage = inspectFragment(diff, file, start as number, end as number);
    if (coverage === 'unparsable') reasons.push('diff fragment is not a parsable unified diff');
    else if (coverage === 'file_absent') reasons.push('diff fragment does not contain the case file');
    else if (coverage === 'range_outside') reasons.push('line range does not intersect a hunk of the file');
  }
  return reasons;
}
