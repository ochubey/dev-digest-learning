import type { CSSProperties } from "react";

export const s = {
  body: { padding: "20px 24px" } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
  dropzone: (dragOver: boolean): CSSProperties => ({
    border: "1.5px dashed " + (dragOver ? "var(--accent)" : "var(--border-strong)"),
    borderRadius: 10,
    padding: "32px 20px",
    textAlign: "center",
    background: dragOver ? "var(--bg-hover)" : "var(--bg-elevated)",
    cursor: "pointer",
  }),
  hint: { fontSize: 12, color: "var(--text-muted)", marginTop: 8 } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)", marginTop: 10 } satisfies CSSProperties,
  fileName: { fontSize: 13, fontWeight: 600, marginBottom: 16 } satisfies CSSProperties,
} as const;
