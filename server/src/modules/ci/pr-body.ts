import type { CiFile } from '@devdigest/shared';
import { CI_BRANCH } from './constants.js';

export function buildPrTitle(agentName: string): string {
  return `Add DevDigest CI review (${agentName})`;
}

/** The install PR body (AC-40): files, review checklist, secret setup, required-check note. */
export function buildPrBody(
  files: CiFile[],
  opts: { checkName: string; updated?: { path: string; agentName: string }[]; agentName: string },
): string {
  const list = files.map((f) => `- \`${f.path}\``).join('\n');
  const updated = (opts.updated ?? [])
    .map((u) => `- \`${u.path}\` (updated so it keeps running next to ${opts.agentName}; it now selects the ${u.agentName} agent)`)
    .join('\n');
  const updatedBlock = updated ? `\n\n## Updated files\n\n${updated}` : '';
  return `This PR adds a DevDigest review agent to this repository's GitHub Actions. It was opened from branch \`${CI_BRANCH}\`.

## Added files

${list}${updatedBlock}

## Review before merging

- [ ] **Permissions:** the workflow asks only for \`contents: read\` and \`pull-requests: write\`.
- [ ] **Triggers:** it runs only on \`pull_request\` events, never on \`pull_request_target\`, and is skipped for pull requests from forks.
- [ ] **Secret handling:** the OpenRouter key is read from the \`OPENROUTER_API_KEY\` repository secret only and appears in no file.
- [ ] **Which code runs:** the job checks out the pull request's base commit, so the manifest, skills and runner come from the default branch and no code from the PR runs.

## Add the secret

Add a repository secret named \`OPENROUTER_API_KEY\` under Settings -> Secrets and variables -> Actions. Without it the review step fails.

## Blocking merges

The check fails when the agent's "Fail CI on" gate triggers, but it blocks merges only if the \`${opts.checkName}\` check is marked required in the repository's branch protection or ruleset. DevDigest cannot do this for you.
`;
}
