import type { CSSProperties } from "react";

export const s = {
  page: { padding: 28, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200 } satisfies CSSProperties,
  h1: { margin: 0, fontSize: 22, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { margin: "4px 0 0", fontSize: 14, color: "var(--text-secondary)" } satisfies CSSProperties,
  scope: { display: "flex", flexDirection: "column", gap: 2, margin: 0, fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
  scopeLine: { margin: 0 } satisfies CSSProperties,
  skeleton: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  skeletonCards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 } satisfies CSSProperties,
  skeletonRows: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  skeletonPair: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 } satisfies CSSProperties,
} as const;
