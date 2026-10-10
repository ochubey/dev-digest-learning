import { PROJECT_CONTEXT_FOLDERS, PROJECT_CONTEXT_SOFT_CAP_TOKENS } from "@devdigest/shared";
import type { ContextSource } from "@devdigest/shared";

/** Group order for unattached rows and the "Serializes as" block (AC-14, AC-32). */
export const SOURCE_ORDER: readonly ContextSource[] = PROJECT_CONTEXT_FOLDERS;

/** Headings of the "Serializes as" block, per source (AC-32). */
export const SERIALIZE_HEADINGS: Record<ContextSource, string> = {
  specs: "## Project specifications",
  docs: "## Project docs",
  insights: "## Project insights",
};

/** Footer total turns into a warning above this many tokens (AC-26). */
export const SOFT_CAP_TOKENS = PROJECT_CONTEXT_SOFT_CAP_TOKENS;

/** Source badge colors; the badge always also carries its text label. */
export const SOURCE_COLOR: Record<ContextSource, string> = {
  specs: "var(--accent-text)",
  docs: "var(--text-secondary)",
  insights: "var(--warn, var(--text-secondary))",
};

/** Browser storage key for the remembered discovery repository (used by ContextRepoPicker). */
export const REPO_STORAGE_KEY = "devdigest.projectContext.repoId";
