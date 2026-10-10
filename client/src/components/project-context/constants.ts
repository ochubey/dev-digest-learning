import type { ContextSource } from "@devdigest/shared";

// Runtime values must NOT be imported from "@devdigest/shared": its barrel uses `.js`
// specifiers that webpack cannot resolve, so the client only imports types from it.
// These mirror the shared contract; contracts-project-context.test.ts pins the parity.

/** Group order for unattached rows and the "Serializes as" block (AC-14, AC-32). */
export const SOURCE_ORDER: readonly ContextSource[] = ["specs", "docs", "insights"];

/** Headings of the "Serializes as" block, per source (AC-32). */
export const SERIALIZE_HEADINGS: Record<ContextSource, string> = {
  specs: "## Project specifications",
  docs: "## Project docs",
  insights: "## Project insights",
};

/** Footer total turns into a warning above this many tokens (AC-26). */
export const SOFT_CAP_TOKENS = 4000;

/** Source badge colors; the badge always also carries its text label. */
export const SOURCE_COLOR: Record<ContextSource, string> = {
  specs: "var(--accent-text)",
  docs: "var(--text-secondary)",
  insights: "var(--warn, var(--text-secondary))",
};

/** Browser storage key for the remembered discovery repository (used by ContextRepoPicker). */
export const REPO_STORAGE_KEY = "devdigest.projectContext.repoId";
