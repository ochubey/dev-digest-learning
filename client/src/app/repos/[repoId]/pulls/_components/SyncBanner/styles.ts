import type { CSSProperties } from "react";

export const s = {
  wrap: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    margin: "0 0 14px",
    padding: "12px 14px",
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
  } satisfies CSSProperties,
  icon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,
  body: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  title: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  detail: { color: "var(--text-muted)", wordBreak: "break-word" } satisfies CSSProperties,
  link: { color: "var(--accent)", fontWeight: 600, width: "fit-content" } satisfies CSSProperties,
} as const;
