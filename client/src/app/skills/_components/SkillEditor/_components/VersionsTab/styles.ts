import type { CSSProperties } from "react";

export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 12,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } satisfies CSSProperties,
  version: { fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actions: { display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" } satisfies CSSProperties,
  body: {
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    maxHeight: 160,
    overflow: "auto",
  } satisfies CSSProperties,
} as const;
