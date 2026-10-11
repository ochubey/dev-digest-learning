import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 8 },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  card: {
    flex: "1 1 160px",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    background: "var(--bg-surface)",
  },
  label: { fontSize: 12, color: "var(--text-muted)" },
  valueRow: { display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  value: { fontSize: 22, fontWeight: 600 },
  delta: { fontSize: 12, color: "var(--text-muted)" },
  notice: { margin: 0, fontSize: 13, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 },
  empty: { margin: 0, fontSize: 13, color: "var(--text-muted)" },
};
