import type { CSSProperties } from "react";

/** Co-located styles for SkillCard — grid card (mirrors AgentCard's colors,
    laid out as a self-contained card rather than a narrow list row). */
export const s = {
  card: (enabled: boolean, active = false, compact = false): CSSProperties => ({
    padding: compact ? 12 : 16,
    borderRadius: compact ? 8 : 10,
    cursor: "pointer",
    border: "1px solid " + (active ? "var(--border-strong)" : "var(--border)"),
    background: active ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: enabled ? 1 : 0.6,
    display: "flex",
    flexDirection: "column",
    ...(compact ? { marginBottom: 10 } : { minHeight: 150 }),
  }),
  /** Compact footer: no top border/spacing, sits in the same row feel as AgentCard. */
  compactFooterRow: {
    display: "flex",
    alignItems: "center",
    marginTop: 8,
  } satisfies CSSProperties,
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "10px 0",
    lineHeight: 1.4,
    flex: 1,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  footerRow: {
    display: "flex",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
} as const;
