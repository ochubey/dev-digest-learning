import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export {
  CI_BRANCH,
  CI_RESULT_ARTIFACT_NAME,
  CI_RUNNER_VERSION,
  CI_TRIGGERS,
  CI_WORKFLOW_PATH,
  CI_WORKFLOW_VERSION,
} from '@devdigest/shared';

/** Where the built agent-runner bundle lives (`pnpm build` in agent-runner/). Overridable via deps. */
export const RUNNER_BUNDLE_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../agent-runner/dist/index.js',
);

export const AGENTS_DIR = '.devdigest/agents';
export const SKILLS_DIR = '.devdigest/skills';
export const MEMORY_PATH = '.devdigest/memory.jsonl';
export const RUNNER_PATH = '.devdigest/runner/index.js';

/** Workflow file name as the GitHub Actions API addresses it. */
export const WORKFLOW_FILE = 'devdigest-review.yml';
/** The file the runner writes and the artifact contains. */
export const RESULT_FILE = 'devdigest-result.json';

/** Pinned third-party actions (A-18): full commit SHAs, tag in the comment (verified against the upstream tags). */
export const ACTION_CHECKOUT = { ref: 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683', tag: 'v4.2.2' } as const;
export const ACTION_SETUP_NODE = { ref: 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', tag: 'v4.4.0' } as const;
export const ACTION_UPLOAD_ARTIFACT = { ref: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02', tag: 'v4.6.2' } as const;

export const MAX_ARCHIVE_BYTES = 1_048_576;
export const MAX_RESULT_JSON_BYTES = 65_536;
export const MAX_RUNS_PER_SYNC = 30;
export const CI_RUNS_PAGE = 100;
export const AGENT_CI_RUNS = 20;
export const SYNC_INSTALL_TIMEOUT_MS = 60_000;

export const CI_EXPORT_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

export const COMMIT_MESSAGE = 'chore(devdigest): add DevDigest CI review';
