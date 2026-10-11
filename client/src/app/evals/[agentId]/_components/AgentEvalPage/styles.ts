import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  page: { padding: 28, display: "flex", flexDirection: "column", gap: 20, maxWidth: 1200 },
  top: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 22, fontWeight: 700 },
  meta: { margin: "2px 0 0", fontSize: 13, color: "var(--text-secondary)" },
  grow: { flex: 1, minWidth: 200 },
  select: {
    height: 32,
    padding: "0 8px",
    borderRadius: 6,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontSize: 13,
  },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  h2: { margin: 0, fontSize: 15, fontWeight: 600 },
  toolbar: { display: "flex", alignItems: "center", gap: 12 },
  hint: { fontSize: 12, color: "var(--text-muted)" },
  muted: { margin: 0, fontSize: 13, color: "var(--text-muted)" },
  error: { margin: 0, fontSize: 13, color: "var(--danger, #b42318)" },
  skeletons: { display: "flex", flexDirection: "column", gap: 10 },
};
