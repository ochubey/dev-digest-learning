import type { CiSecretState } from "@devdigest/shared";

/** Badge colours per OPENROUTER_API_KEY state ("checking" is the loading state). */
export const SECRET_BADGE: Record<CiSecretState | "checking", { color: string; bg: string; key: string }> = {
  set: { color: "var(--ok)", bg: "var(--ok-bg, var(--bg-hover))", key: "set" },
  not_set: { color: "var(--warn)", bg: "var(--warn-bg, var(--bg-hover))", key: "notSet" },
  unknown: { color: "var(--text-secondary)", bg: "var(--bg-hover)", key: "unknown" },
  checking: { color: "var(--text-secondary)", bg: "var(--bg-hover)", key: "checking" },
};
