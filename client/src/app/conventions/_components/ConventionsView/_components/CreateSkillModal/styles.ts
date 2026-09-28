import type { CSSProperties } from "react";

export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,
  intro: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.5 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
} as const;
