import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { fontSize: 13, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 },
  summary: { cursor: "pointer", fontWeight: 500 },
  list: { margin: "6px 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 },
};
