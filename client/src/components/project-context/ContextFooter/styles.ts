import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 12px",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  totalRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  total: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  totalWarn: { fontSize: 13, fontWeight: 600, color: "var(--warn)" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
