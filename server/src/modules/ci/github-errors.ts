import { AppError } from '../../platform/errors.js';

const status = (err: unknown): number | undefined =>
  (err as { status?: number })?.status ?? (err as { response?: { status?: number } })?.response?.status;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** First line of an upstream message, capped; never headers or bodies. */
const brief = (err: unknown): string => message(err).split('\n')[0]!.slice(0, 300);

export const WORKFLOW_SCOPE_MESSAGE =
  'The studio GitHub token cannot add files under .github/workflows/. Give it the `workflow` scope (classic) or Workflows: Read and write (fine-grained), or download the zip and add the files yourself.';

/** Maps a GitHub write failure (commit / PR) to a coded error (AC-42, AC-44, AC-45). */
export function mapWriteError(err: unknown, repo: string): AppError {
  const msg = message(err);
  if (/workflow/i.test(msg) && /scope|permission/i.test(msg)) {
    return new AppError('github_workflow_scope_missing', WORKFLOW_SCOPE_MESSAGE, 403);
  }
  const s = status(err);
  if (s === 403 || s === 404) {
    return new AppError(
      'github_write_denied',
      `The studio GitHub token cannot write to ${repo}. It needs Contents: Read and write and Pull requests: Read and write on this repository.`,
      403,
    );
  }
  return new AppError('github_error', brief(err), 502);
}

export interface ReadFailure {
  code: string;
  message: string;
}

/** Maps a GitHub Actions read failure to a per-repository sync failure (AC-69). */
export function mapReadError(err: unknown, repo: string): ReadFailure {
  if (status(err) === 403) {
    return {
      code: 'github_actions_read_denied',
      message: `The studio GitHub token cannot read GitHub Actions in ${repo}. It needs Actions: Read (fine-grained) or the \`repo\` scope (classic).`,
    };
  }
  return { code: 'github_error', message: brief(err) };
}
