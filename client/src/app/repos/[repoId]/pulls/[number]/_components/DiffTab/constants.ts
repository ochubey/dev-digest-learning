import type { SmartDiffRole } from "@devdigest/shared";

/** Roles whose group body starts hidden. */
export const COLLAPSED_BY_DEFAULT: ReadonlySet<SmartDiffRole> = new Set<SmartDiffRole>([
  "docs",
  "boilerplate",
]);

/** Display order of the roles (matches the server contract order). */
export const ROLE_ORDER: readonly SmartDiffRole[] = ["core", "tests", "wiring", "docs", "boilerplate"];

/** Colour square shown before each role label. */
export const ROLE_COLOR: Record<SmartDiffRole, string> = {
  core: "#3b82f6",
  tests: "#8b5cf6",
  wiring: "#f59e0b",
  docs: "#14b8a6",
  boilerplate: "#6b7280",
};
