import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  page: { padding: 28, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200 },
  h1: { margin: 0, fontSize: 22, fontWeight: 700 },
  subtitle: { margin: "4px 0 0", fontSize: 14, color: "var(--text-secondary)" },
  h2: { margin: 0, fontSize: 15, fontWeight: 600 },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 500 },
  td: { padding: "10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" },
  row: { cursor: "pointer" },
  nameBtn: { all: "unset", cursor: "pointer", fontWeight: 600, color: "var(--text-primary)" },
  muted: { color: "var(--text-muted)" },
  skeletons: { display: "flex", flexDirection: "column", gap: 10 },
  emptyLink: { color: "var(--accent)", fontWeight: 600 },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "60px 28px", textAlign: "center" },
};
