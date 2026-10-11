export const VIEWS = ["columns", "tabs"] as const;
export type ResultsView = (typeof VIEWS)[number];
export const DEFAULT_VIEW: ResultsView = "columns";
/** Max characters of a finding title / path shown in a compact column item. */
export const TRUNCATE_AT = 80;
