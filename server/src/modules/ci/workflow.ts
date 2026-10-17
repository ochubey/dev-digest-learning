import { CI_TRIGGERS, type CiPostAs, type CiTrigger } from '@devdigest/shared';
import {
  ACTION_CHECKOUT,
  ACTION_SETUP_NODE,
  ACTION_UPLOAD_ARTIFACT,
  CI_RESULT_ARTIFACT_NAME,
  CI_WORKFLOW_VERSION,
  RESULT_FILE,
  RUNNER_PATH,
  WORKFLOW_FILE,
  jobIdFor,
} from './constants.js';

/** The job-level fork guard: the job runs only for PRs from the same repository (AC-23). */
export const FORK_GUARD = 'github.event.pull_request.head.repo.full_name == github.repository';
export const BASE_SHA_REF = '${{ github.event.pull_request.base.sha }}';
export const SECRET_EXPR = '${{ secrets.OPENROUTER_API_KEY }}';

/**
 * The generated GitHub Actions workflow (AC-19..AC-28, AC-33). A fixed template: only the
 * triggers (canonical order) and the post mode vary. No clock, no secrets.
 */
export function generateWorkflow(opts: {
  triggers: CiTrigger[];
  postAs: CiPostAs;
  /** The agent slug the runner picks its manifest by (DEVDIGEST_AGENT). */
  slug: string;
  /** Workflow file name; decides the job id/name. Defaults to the legacy file. */
  file?: string;
}): string {
  const job = jobIdFor(opts.file ?? WORKFLOW_FILE);
  const types = CI_TRIGGERS.filter((t) => opts.triggers.includes(t)).join(', ');
  return `# devdigest-workflow-version: ${CI_WORKFLOW_VERSION}
name: DevDigest Review (${opts.slug})
on:
  pull_request:
    types: [${types}]
permissions:
  contents: read
  pull-requests: write
jobs:
  ${job}:
    name: ${job}
    if: ${FORK_GUARD}
    runs-on: ubuntu-latest
    steps:
      - uses: ${ACTION_CHECKOUT.ref} # ${ACTION_CHECKOUT.tag}
        with:
          ref: ${BASE_SHA_REF}
          persist-credentials: false
      - uses: ${ACTION_SETUP_NODE.ref} # ${ACTION_SETUP_NODE.tag}
        with:
          node-version: 22
      - name: Run DevDigest review
        if: hashFiles('${RUNNER_PATH}') != ''
        run: node ${RUNNER_PATH}
        env:
          OPENROUTER_API_KEY: ${SECRET_EXPR}
          GITHUB_TOKEN: \${{ github.token }}
          PR_NUMBER: \${{ github.event.pull_request.number }}
          DEVDIGEST_POST_AS: ${opts.postAs}
          DEVDIGEST_AGENT: ${opts.slug}
      - uses: ${ACTION_UPLOAD_ARTIFACT.ref} # ${ACTION_UPLOAD_ARTIFACT.tag}
        if: always()
        with:
          name: ${CI_RESULT_ARTIFACT_NAME}
          path: ${RESULT_FILE}
          if-no-files-found: ignore
`;
}
