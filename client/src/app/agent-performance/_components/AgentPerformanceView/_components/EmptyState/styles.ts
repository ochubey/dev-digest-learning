import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "48px 28px", textAlign: "center" } satisfies CSSProperties,
  title: { margin: 0, fontSize: 16, fontWeight: 700 } satisfies CSSProperties,
  line: { margin: 0, fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  link: { color: "var(--accent)", fontWeight: 600, fontSize: 13 } satisfies CSSProperties,
} as const;
