import type { EvalCaseDraft } from '@devdigest/shared';
import { EVAL_CASE_NAME_MAX } from './constants.js';
import { buildFragment } from './fragment.js';

export const FINDING_NOT_IN_DIFF_MESSAGE = "The finding's lines are no longer in the PR diff";
export const FRAGMENT_TOO_LARGE_MESSAGE = 'The diff fragment for this finding is too large to store as an eval case';

export interface DraftFinding {
  id: string;
  pr_id: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
}

export type DraftResult =
  | { draft: EvalCaseDraft }
  | { error: 'finding_not_in_diff' | 'fragment_too_large'; message: string };

/** Slug of at most `EVAL_CASE_NAME_MAX` characters; never empty. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, EVAL_CASE_NAME_MAX)
    .replace(/-+$/g, '');
  return slug || 'eval-case';
}

/** AC-4, AC-5, AC-6, AC-11: pure draft of an eval case from a decided finding. */
export function draftFromFinding(a: {
  finding: DraftFinding;
  decision: 'accepted' | 'dismissed';
  rawDiff: string;
  agentId: string | null;
  existing: EvalCaseDraft['existing_cases'];
}): DraftResult {
  const { finding } = a;
  const frag = buildFragment(a.rawDiff, finding.file, finding.start_line, finding.end_line);
  if ('error' in frag) {
    return frag.error === 'too_large'
      ? { error: 'fragment_too_large', message: FRAGMENT_TOO_LARGE_MESSAGE }
      : { error: 'finding_not_in_diff', message: FINDING_NOT_IN_DIFF_MESSAGE };
  }
  const accepted = a.decision === 'accepted';
  return {
    draft: {
      finding_id: finding.id,
      pr_id: finding.pr_id,
      agent_id: a.agentId,
      name: slugify(finding.title),
      expectation: {
        kind: accepted ? 'must_find' : 'must_not_flag',
        file: finding.file,
        start_line: finding.start_line,
        end_line: finding.end_line,
      },
      input_diff: frag.fragment,
      origin: accepted ? 'accepted_finding' : 'dismissed_finding',
      existing_cases: a.existing,
    },
  };
}
