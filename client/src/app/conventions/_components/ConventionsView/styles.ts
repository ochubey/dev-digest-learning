import type { CSSProperties } from "react";

/** Co-located styles for ConventionsView. */
export const s = {
  wrap: { padding: 24, maxWidth: 880, margin: "0 auto" } satisfies CSSProperties,
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  h1: { fontSize: 20, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  repoPicker: { display: "flex", alignItems: "center", gap: 10, marginBottom: 20 } satisfies CSSProperties,
  repoLabel: { fontSize: 13, color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  repoSelectWrap: { width: 320 } satisfies CSSProperties,
  actionsRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 12 } satisfies CSSProperties,
} as const;
