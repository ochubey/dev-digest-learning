import type { CSSProperties } from "react";

export const s = {
  chooseBody: { padding: 20, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  chooseOption: {
    textAlign: "left",
    padding: 16,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
  chooseTitle: { fontSize: 14, fontWeight: 600, marginBottom: 4 } satisfies CSSProperties,
  chooseSubtitle: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  body: { padding: 24 } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
