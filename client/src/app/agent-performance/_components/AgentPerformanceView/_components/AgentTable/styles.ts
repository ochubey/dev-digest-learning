import type { CSSProperties } from "react";

export const s = {
  section: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  h2: { margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)" } satisfies CSSProperties,
  status: { margin: 0, fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  scroll: { overflowX: "auto" } satisfies CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 } satisfies CSSProperties,
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap" } satisfies CSSProperties,
  thInner: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  sortBtn: { all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 500, color: "inherit" } satisfies CSSProperties,
  td: { padding: "10px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" } satisfies CSSProperties,
  agentCell: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } satisfies CSSProperties,
  expandBtn: { all: "unset", cursor: "pointer", display: "inline-flex", alignItems: "center", color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  name: { fontWeight: 600, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } satisfies CSSProperties,
  link: { color: "var(--accent)", fontWeight: 600 } satisfies CSSProperties,
  detailTd: { padding: "10px 10px 14px 34px", borderBottom: "1px solid var(--border)", background: "var(--bg-hover)" } satisfies CSSProperties,
  detail: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, margin: 0 } satisfies CSSProperties,
  detailItem: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  detailLabel: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" } satisfies CSSProperties,
  detailValue: { margin: 0, fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
} as const;
