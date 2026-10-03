import type { SmartDiffRole } from "@devdigest/shared";

/** Roles whose group body starts hidden. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<SmartDiffRole> = new Set<SmartDiffRole>([
  "docs",
  "boilerplate",
]);
