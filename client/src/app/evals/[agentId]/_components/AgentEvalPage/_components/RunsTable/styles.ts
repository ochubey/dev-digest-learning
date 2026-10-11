import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", width: "100%" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 },
  td: { padding: "8px 10px", borderBottom: "1px solid var(--border)" },
  linkBtn: { all: "unset", cursor: "pointer", color: "var(--accent)", fontWeight: 600 },
};
