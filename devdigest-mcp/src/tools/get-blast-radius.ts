import { z } from 'zod';
import { apiBase, apiGet, ApiHttpError, type ApiOptions } from '../api.js';

export const TOOL_NAME = 'get_blast_radius';

export const TOOL_CONFIG = {
  title: 'Get PR blast radius',
  description:
    'Show what else in the repository a DevDigest pull request can affect. Call it when reviewing ' +
    'or assessing a PR, before judging a change by its diff alone. Returns the changed symbols, ' +
    'their callers as file:line, and the HTTP endpoints and cron jobs that depend on them, plus a ' +
    'one-line `summary`. The same data the PR Overview tab shows. Read-only. ' +
    'Identify the PR either by `pr_id` or by `repo` ("owner/name") together with the GitHub PR ' +
    '`number`. `degraded: true` with a `reason` means the repository index is missing or ' +
    'partial, so the map may be incomplete.',
  inputSchema: {
    pr_id: z
      .string()
      .uuid()
      .optional()
      .describe('DevDigest pull request id (uuid). Optional when `repo` and `number` are given'),
    repo: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/, 'expected "owner/name"')
      .optional()
      .describe('Repository as "owner/name", for example "ochubey/dev-digest-learning"'),
    number: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('GitHub pull request number, used together with `repo`'),
  },
  annotations: { readOnlyHint: true },
};

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface BlastArgs {
  pr_id?: string;
  repo?: string;
  number?: number;
}

/** The caller gave an unusable combination of arguments, or the repo/PR is not in DevDigest. */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInputError';
  }
}

interface RepoRow {
  id: string;
  full_name: string;
}
interface PullRow {
  id: string;
  number: number;
}

/** Resolve the DevDigest PR id: as given, or via repo "owner/name" + GitHub PR number. */
export async function resolvePrId(args: BlastArgs, opts: ApiOptions = {}): Promise<string> {
  if (args.pr_id) return args.pr_id;
  if (!args.repo || args.number === undefined) {
    throw new UserInputError('Provide `pr_id`, or `repo` ("owner/name") together with `number`.');
  }
  const repos = await apiGet<RepoRow[]>('/repos', opts);
  const repo = repos.find((r) => r.full_name.toLowerCase() === args.repo!.toLowerCase());
  if (!repo) {
    const known = repos.map((r) => r.full_name).join(', ') || 'none';
    throw new UserInputError(`Repo ${args.repo} is not in DevDigest. Known repos: ${known}.`);
  }
  const pulls = await apiGet<PullRow[]>(`/repos/${encodeURIComponent(repo.id)}/pulls`, opts);
  const pr = pulls.find((p) => p.number === args.number);
  if (!pr) {
    throw new UserInputError(
      `PR #${args.number} was not found in ${repo.full_name}. DevDigest lists the most recent PRs; open the repo in DevDigest to sync it.`,
    );
  }
  return pr.id;
}

/** Actionable message for a failed call; the agent should know what to fix or retry. */
export function describeError(err: unknown, prRef: string, base: string): string {
  if (err instanceof UserInputError) return err.message;
  if (err instanceof ApiHttpError) {
    if (err.status === 404) {
      return `PR ${prRef} not found in DevDigest. Check the id, or pass repo "owner/name" and the GitHub PR number.`;
    }
    if (err.status === 403) return `PR ${prRef} belongs to another workspace; access denied.`;
    if (err.status === 422) return `pr_id must be a valid uuid, got "${prRef}".`;
    return `DevDigest API error: ${err.message}`;
  }
  return `DevDigest API unreachable at ${base}: ${(err as Error).message}. Is the server running (DEVDIGEST_API_BASE)?`;
}

/** Calls GET /pulls/:id/blast and returns the JSON body as compact text; failures become isError results. */
export async function getBlastRadius(
  args: BlastArgs,
  opts: ApiOptions = {},
): Promise<ToolResult> {
  const ref = args.pr_id ?? `${args.repo ?? '?'}#${args.number ?? '?'}`;
  try {
    const id = await resolvePrId(args, opts);
    const body = await apiGet(`/pulls/${encodeURIComponent(id)}/blast`, opts);
    return { content: [{ type: 'text', text: JSON.stringify(body) }] };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: describeError(err, ref, opts.baseUrl ?? apiBase()) }],
    };
  }
}
