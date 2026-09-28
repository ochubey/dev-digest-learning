import type { TabDef } from "@devdigest/ui";

/** Editor tabs — Config / Preview / Versions only (per scope: no Context,
    Evals, Stats tabs from the design mock). */
export const TABS: readonly TabDef[] = [
  { key: "config", label: "Config", icon: "Settings" },
  { key: "preview", label: "Preview", icon: "Eye" },
  { key: "versions", label: "Versions", icon: "History" },
];
