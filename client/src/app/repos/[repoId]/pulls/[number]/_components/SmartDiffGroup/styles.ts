import type { CSSProperties } from "react";

export const s = {
  group: (empty: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 8,
    opacity: empty ? 0.55 : 1,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  header: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "left",
  } satisfies CSSProperties,
  swatch: (color: string): CSSProperties => ({
    width: 10,
    height: 10,
    borderRadius: 2,
    background: color,
    flexShrink: 0,
  }),
  description: { color: "var(--text-muted)", fontWeight: 400 } satisfies CSSProperties,
  badges: { display: "inline-flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  findingsBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  findingsDot: (color: string): CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
  }),
  count: { color: "var(--text-muted)", fontSize: 12 } satisfies CSSProperties,
  toggleFiles: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    cursor: "pointer",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
};

export function chevronStyle(open: boolean): CSSProperties {
  return { transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" };
}
