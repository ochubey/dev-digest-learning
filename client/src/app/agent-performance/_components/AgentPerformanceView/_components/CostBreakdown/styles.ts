import type { CSSProperties } from "react";

export const s = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 } satisfies CSSProperties,
  section: { display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, minWidth: 0 } satisfies CSSProperties,
  heading: { margin: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  item: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", alignItems: "baseline", columnGap: 12, fontSize: 13 } satisfies CSSProperties,
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  amount: { fontWeight: 600 } satisfies CSSProperties,
  share: { color: "var(--text-secondary)", fontSize: 12, minWidth: 36, textAlign: "right" } satisfies CSSProperties,
  bar: { gridColumn: "1 / -1", height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "space-between", gap: 12, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: 700 } satisfies CSSProperties,
  none: { margin: 0, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
