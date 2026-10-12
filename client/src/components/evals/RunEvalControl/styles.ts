import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" },
  confirm: { display: "flex", flexDirection: "column", gap: 8 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  select: {
    height: 32,
    padding: "0 8px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated, var(--bg))",
    color: "var(--text)",
    fontSize: 13,
    maxWidth: 420,
  },
  hint: { margin: 0, fontSize: 12, color: "var(--text-muted)" },
  actions: { display: "flex", gap: 8 },
  text: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 13, color: "var(--danger, #b42318)" },
};
