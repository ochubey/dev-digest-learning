import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  synced: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  warning: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--bg-surface)",
    fontSize: 12.5,
  } satisfies CSSProperties,
  warningTitle: { margin: 0, fontWeight: 600 } satisfies CSSProperties,
  warningList: { margin: "6px 0 0", paddingLeft: 18, overflowWrap: "anywhere" } satisfies CSSProperties,
  error: { margin: 0, fontSize: 12.5, color: "var(--crit)" } satisfies CSSProperties,
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "48px 0", textAlign: "center" } satisfies CSSProperties,
  emptyText: { margin: 0, fontSize: 14, color: "var(--text-secondary)", maxWidth: 520 } satisfies CSSProperties,
  emptyTitle: { margin: 0, fontSize: 14, fontWeight: 600 } satisfies CSSProperties,
  link: { color: "var(--accent)", fontSize: 13 } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
} as const;
