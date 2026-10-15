import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 960 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  title: { margin: 0, fontSize: 16, fontWeight: 700, flex: 1 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,
  rowTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  repo: { fontFamily: "var(--font-mono, monospace)", fontSize: 13, fontWeight: 600, flex: 1, overflowWrap: "anywhere" } satisfies CSSProperties,
  meta: { display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  link: { color: "var(--accent)" } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  hint: { margin: 0, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  error: { margin: 0, fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
  failOn: { display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
