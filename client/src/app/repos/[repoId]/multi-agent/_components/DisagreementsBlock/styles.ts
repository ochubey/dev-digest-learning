import type { CSSProperties } from "react";

export const s = {
  root: { marginTop: 22 } satisfies CSSProperties,
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } satisfies CSSProperties,
  title: { fontSize: 15, fontWeight: 650, margin: 0, flex: 1 } satisfies CSSProperties,
  switchLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  message: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  rows: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowHead: { padding: "10px 14px", borderBottom: "1px solid var(--border)" } satisfies CSSProperties,
  loc: { fontSize: 12 } satisfies CSSProperties,
  rowTitle: { fontSize: 13, fontWeight: 600, marginLeft: 6 } satisfies CSSProperties,
  takes: (n: number): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: `repeat(${Math.max(n, 1)}, 1fr)`,
    gap: 1,
    background: "var(--border)",
  }),
  cell: { padding: "10px 14px", background: "var(--bg-elevated)" } satisfies CSSProperties,
  persona: { fontSize: 11.5, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 } satisfies CSSProperties,
  verdictRow: { display: "flex", alignItems: "center", gap: 5, marginBottom: 4 } satisfies CSSProperties,
  dot: (color: string): CSSProperties => ({ width: 7, height: 7, borderRadius: 99, background: color }),
  verdict: (flagged: boolean): CSSProperties => ({
    fontSize: 11,
    fontWeight: 600,
    color: flagged ? "var(--text-primary)" : "var(--text-muted)",
    textTransform: flagged ? "uppercase" : "none",
    letterSpacing: flagged ? "0.03em" : 0,
  }),
  note: { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 } satisfies CSSProperties,
};
