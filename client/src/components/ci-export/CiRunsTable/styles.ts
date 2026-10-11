import type { CSSProperties } from "react";

export const s = {
  wrap: { border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", background: "var(--bg-elevated)" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } satisfies CSSProperties,
  th: {
    textAlign: "left",
    padding: "10px 12px",
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  td: { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "top" } satisfies CSSProperties,
  mono: { fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  prNumber: { fontFamily: "var(--font-mono, monospace)", fontSize: 11.5, color: "var(--accent-text)", marginRight: 6 } satisfies CSSProperties,
  title: { overflowWrap: "anywhere" } satisfies CSSProperties,
  reason: { marginTop: 4, fontSize: 11.5, color: "var(--text-secondary)", overflowWrap: "anywhere" } satisfies CSSProperties,
  findings: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  link: { color: "var(--accent)", whiteSpace: "nowrap" } satisfies CSSProperties,
} as const;

export const STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--ok)",
  no_findings: "var(--text-secondary)",
  failed: "var(--crit)",
  running: "var(--accent)",
};
