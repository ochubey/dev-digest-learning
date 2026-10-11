import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  summary: { margin: 0, fontSize: 13, color: "var(--text-secondary)" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 },
  card: { border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  head: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { fontWeight: 600, fontSize: 14, overflowWrap: "anywhere" },
  tag: { fontSize: 12, padding: "1px 8px", borderRadius: 4, border: "1px solid var(--border)" },
  expected: { margin: 0, fontSize: 12, color: "var(--text-muted)" },
  groupTitle: { margin: "4px 0 0", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" },
  findings: { margin: 0, paddingLeft: 18, fontSize: 13, display: "flex", flexDirection: "column", gap: 4 },
  finding: { overflowWrap: "anywhere" },
  reason: { display: "block", fontSize: 12, color: "var(--text-muted)" },
  error: { margin: 0, fontSize: 13, color: "var(--danger, #b42318)", overflowWrap: "anywhere" },
  muted: { margin: 0, fontSize: 13, color: "var(--text-muted)" },
};
