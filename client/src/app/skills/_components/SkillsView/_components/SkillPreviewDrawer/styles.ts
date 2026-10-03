import type { CSSProperties } from "react";

export const s = {
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 18 } satisfies CSSProperties,
  body: { maxWidth: 760 } satisfies CSSProperties,
  empty: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 } satisfies CSSProperties,
} as const;
