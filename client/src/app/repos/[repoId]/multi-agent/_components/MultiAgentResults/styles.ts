import type { CSSProperties } from "react";

export const s = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "18px 28px 14px",
  } satisfies CSSProperties,
  title: { fontSize: 20, fontWeight: 650, margin: 0 } satisfies CSSProperties,
  sub: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  spacer: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 28px",
    borderTop: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  prNumber: { color: "var(--text-muted)" } satisfies CSSProperties,
  prTitle: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  totals: { marginLeft: "auto" } satisfies CSSProperties,
  switchWrap: { display: "inline-flex", gap: 2 } satisfies CSSProperties,
  body: { padding: "20px 28px 40px" } satisfies CSSProperties,
  skeleton: { padding: "20px 28px", display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
  notFoundLink: { fontSize: 13, color: "var(--accent-text)" } satisfies CSSProperties,
};

/** Columns grid: up to 5 equal columns, scrolling beyond that. */
export function columnsGrid(n: number): CSSProperties {
  const cols = Math.min(Math.max(n, 1), 5);
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, minmax(220px, 1fr))`,
    gap: 12,
    overflowX: n > 5 ? "auto" : "visible",
  };
}
