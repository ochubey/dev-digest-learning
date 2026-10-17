import type { CSSProperties } from "react";

export const secretsStyles = {
  box: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "11px 13px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  title: { margin: 0, fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  row: { display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, flexWrap: "wrap" } satisfies CSSProperties,
  name: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-primary)" } satisfies CSSProperties,
  desc: { color: "var(--text-secondary)" } satisfies CSSProperties,
  right: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footer: { margin: 0, fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
