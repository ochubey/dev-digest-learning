import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" },
  confirm: { display: "flex", flexDirection: "column", gap: 8 },
  actions: { display: "flex", gap: 8 },
  text: { margin: 0, fontSize: 13 },
  error: { margin: 0, fontSize: 13, color: "var(--danger, #b42318)" },
};
