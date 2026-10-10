import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 } satisfies CSSProperties,
  title: { margin: 0, fontSize: 16, fontWeight: 600 } satisfies CSSProperties,
  hint: { margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
