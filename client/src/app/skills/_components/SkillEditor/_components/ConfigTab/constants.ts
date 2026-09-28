import type { SkillType } from "@devdigest/shared";

/** Options for the type `SelectInput`. */
export const SKILL_TYPE_OPTIONS: { value: SkillType; label: string }[] = [
  { value: "rubric", label: "Rubric" },
  { value: "convention", label: "Convention" },
  { value: "security", label: "Security" },
  { value: "custom", label: "Custom" },
];

/** Rough token estimate (~4 chars/token) — no token-count API client-side,
    so this mirrors the design mock's own approximation rather than being
    exact. */
export function estimateTokens(body: string): number {
  return Math.round(body.length / 4);
}
