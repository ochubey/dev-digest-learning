import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 12 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  countBadge: { marginLeft: "auto" } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 } satisfies CSSProperties,
  filterRow: { marginBottom: 12 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    borderBottom: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  dragHandle: { color: "var(--text-muted)", cursor: "grab", display: "inline-flex" } satisfies CSSProperties,
  dragHandleDisabled: {
    color: "var(--text-muted)",
    opacity: 0.35,
    cursor: "not-allowed",
    display: "inline-flex",
  } satisfies CSSProperties,
  name: { flex: 1, fontSize: 14, fontWeight: 500 } satisfies CSSProperties,
  empty: { padding: 24, textAlign: "center", color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
