import type { CSSProperties } from "react";

export const s = {
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  header: {
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
  findingsBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  findingsDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--warn)",
  } satisfies CSSProperties,
  count: {
    color: "var(--text-muted)",
    fontWeight: 400,
    // Styling-only separator from the label/counter (no text glyph, no i18n).
    borderLeft: "1px solid var(--border)",
    paddingLeft: 8,
  } satisfies CSSProperties,
};

export function chevronStyle(open: boolean): CSSProperties {
  return { transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" };
}
