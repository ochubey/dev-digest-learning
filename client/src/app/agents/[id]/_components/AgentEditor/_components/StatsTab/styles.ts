import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 18, maxWidth: 960 } satisfies CSSProperties,
  applied: { margin: 0, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  notes: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
    gap: 12,
    margin: 0,
  } satisfies CSSProperties,
  metric: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  label: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "var(--text-secondary)" } satisfies CSSProperties,
  value: { margin: 0, fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  empty: { display: "flex", flexDirection: "column", gap: 6, padding: "20px 0" } satisfies CSSProperties,
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  emptyBody: { margin: 0, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
