/** Constants for ConfigureRun. */

/** Max agents per multi-agent run (mirrors RunRequest.agentIds.max in @devdigest/shared). */
export const MAX_AGENTS = 5;

/** Accent palette for agent cards (existing design tokens): [colour, faint background]. */
export const AGENT_ACCENTS: readonly { color: string; bg: string }[] = [
  { color: "var(--accent)", bg: "var(--accent-bg)" },
  { color: "var(--ok)", bg: "var(--ok-bg)" },
  { color: "var(--warn)", bg: "var(--warn-bg)" },
  { color: "var(--crit)", bg: "var(--crit-bg)" },
  { color: "var(--accent-text)", bg: "var(--info-bg)" },
  { color: "var(--info)", bg: "var(--info-bg)" },
];
