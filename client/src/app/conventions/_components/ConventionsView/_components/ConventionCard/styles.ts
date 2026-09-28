import type { CSSProperties } from "react";

export const s = {
  card: { padding: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-elevated)" } satisfies CSSProperties,
  rule: { fontSize: 14, lineHeight: 1.5, marginBottom: 10 } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 } satisfies CSSProperties,
  evidence: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  actionsRow: { display: "flex", alignItems: "center", gap: 8, paddingTop: 10, borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  editForm: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
} as const;
