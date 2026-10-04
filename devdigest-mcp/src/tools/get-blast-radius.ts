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
    '`degraded: true` with a `reason` means the repository index is missing or partial, so the ' +
    'map may be incomplete.',
  inputSchema: {
    pr_id: z
      .string()
      .uuid()
      .describe('DevDigest pull request id (uuid), the id in the PR page URL, not the GitHub PR number'),
  },
  annotations: { readOnlyHint: true },
};

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Actionable message for a failed call; the agent should know what to fix or retry. */
export function describeError(err: unknown, prId: string, base: string): string {
  if (err instanceof ApiHttpError) {
    if (err.status === 404) {
      return `PR ${prId} not found in DevDigest. Check that pr_id is the DevDigest PR id (uuid), not the GitHub PR number.`;
    }
    if (err.status === 403) return `PR ${prId} belongs to another workspace; access denied.`;
    if (err.status === 422) return `pr_id must be a valid uuid, got "${prId}".`;
    return `DevDigest API error: ${err.message}`;
  }
  return `DevDigest API unreachable at ${base}: ${(err as Error).message}. Is the server running (DEVDIGEST_API_BASE)?`;
}

/** Calls GET /pulls/:id/blast and returns the JSON body as compact text; failures become isError results. */
export async function getBlastRadius(
  args: { pr_id: string },
  opts: ApiOptions = {},
): Promise<ToolResult> {
  try {
    const body = await apiGet(`/pulls/${encodeURIComponent(args.pr_id)}/blast`, opts);
    return { content: [{ type: 'text', text: JSON.stringify(body) }] };
  } catch (err) {
    return {
      isError: true,
      content: [
        { type: 'text', text: describeError(err, args.pr_id, opts.baseUrl ?? apiBase()) },
      ],
    };
  }
}
