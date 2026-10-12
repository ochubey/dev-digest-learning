import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { margin: 0, fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  hint: { margin: 0, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  serializes: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "10px 12px",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
  } satisfies CSSProperties,
  serializesLabel: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  pre: { margin: 0, fontSize: 12, whiteSpace: "pre-wrap" } satisfies CSSProperties,
} as const;
