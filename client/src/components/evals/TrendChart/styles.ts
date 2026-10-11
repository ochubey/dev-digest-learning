import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
  legend: { display: "flex", gap: 16, flexWrap: "wrap", margin: 0, padding: 0, listStyle: "none", fontSize: 12, color: "var(--text-secondary)" },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  muted: { margin: 0, fontSize: 13, color: "var(--text-muted)" },
  svg: { width: "100%", height: "auto", display: "block", overflow: "visible" },
};
