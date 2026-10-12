import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 6, maxWidth: 360 } satisfies CSSProperties,
  label: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
