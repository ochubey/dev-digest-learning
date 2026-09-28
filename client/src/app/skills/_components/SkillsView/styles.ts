import type { CSSProperties } from "react";

/** Co-located styles for SkillsView — real CSS grid of skill cards. */
export const s = {
  wrap: { display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "16px 28px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  h1: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  searchRow: {
    display: "flex",
    alignItems: "center",
    marginLeft: "auto",
    width: 260,
    padding: "6px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 16,
  } satisfies CSSProperties,
} as const;
