import type { CiFailOn, CiPostAs, CiTrigger } from "@devdigest/shared";

/* Local mirrors of the shared CI constants (the client may import only types from
   @devdigest/shared; a runtime import breaks `next build`). */

export const CI_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize", "reopened"];
export const DEFAULT_TRIGGERS: readonly CiTrigger[] = ["opened", "synchronize"];
export const POST_AS_VALUES: readonly CiPostAs[] = ["github_review", "pr_comment", "none"];
export const DEFAULT_POST_AS: CiPostAs = "github_review";
export const FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

export const CI_BRANCH = "devdigest/ci";
export const CI_WORKFLOW_PATH = ".github/workflows/devdigest-review.yml";

/** The only links the UI follows for GitHub-provided URLs. */
export const GITHUB_PREFIX = "https://github.com/";

/** Wizard steps, in order (labels live in `ciExport.steps`). */
export const WIZARD_STEPS = ["target", "preview", "configure", "install"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Server error codes the wizard reacts to. */
export const CI_CODE = {
  workflowUnsafe: "ci_workflow_unsafe",
  workflowScopeMissing: "github_workflow_scope_missing",
} as const;
