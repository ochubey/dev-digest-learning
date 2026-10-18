import type { CSSProperties } from "react";

export const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 } satisfies CSSProperties,
  card: { display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, minWidth: 0 } satisfies CSSProperties,
  label: { margin: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" } satisfies CSSProperties,
  value: { fontSize: 22, fontWeight: 700, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  valueSmall: { fontSize: 15, fontWeight: 600 } satisfies CSSProperties,
  sub: { display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
