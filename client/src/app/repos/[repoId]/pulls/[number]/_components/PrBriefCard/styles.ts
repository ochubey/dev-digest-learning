import React from "react";

const mono = "var(--font-mono, monospace)";

export const s = {
  wrap: { marginBottom: 20 } as React.CSSProperties,

  header: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 } as React.CSSProperties,

  headerActions: { display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" } as React.CSSProperties,

  generatedAt: { fontSize: 11.5, color: "var(--text-muted)" } as React.CSSProperties,

  staleBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 5,
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--warn)",
    border: "1px solid var(--warn)",
  } as React.CSSProperties,

  loadingWrap: { display: "flex", flexDirection: "column", gap: 12, padding: "12px 0" } as React.CSSProperties,

  summary: { fontSize: 13.5, color: "var(--text-primary)", margin: "0 0 14px", lineHeight: 1.5, whiteSpace: "pre-wrap" } as React.CSSProperties,

  sectionLabel: { fontSize: 11.5, fontWeight: 650, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)", margin: "12px 0 6px" } as React.CSSProperties,

  muted: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } as React.CSSProperties,

  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 } as React.CSSProperties,

  riskItem: { display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 } as React.CSSProperties,

  riskHeader: { display: "flex", alignItems: "center", gap: 8 } as React.CSSProperties,

  chevron: { background: "none", border: "none", padding: 2, display: "inline-flex", color: "var(--text-secondary)", cursor: "pointer" } as React.CSSProperties,

  riskBody: { paddingLeft: 24 } as React.CSSProperties,

  riskExplanation: { margin: "0 0 6px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" } as React.CSSProperties,

  refList: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 } as React.CSSProperties,

  skeletonGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } as React.CSSProperties,

  stats: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text-secondary)", margin: "0 0 12px" } as React.CSSProperties,

  statsLabel: { color: "var(--text-muted)" } as React.CSSProperties,

  chip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 6px", borderRadius: 5, border: "1px solid var(--border)" } as React.CSSProperties,

  dimmed: { opacity: 0.5 } as React.CSSProperties,

  hint: { marginLeft: 6, fontSize: 11, color: "var(--text-muted)" } as React.CSSProperties,

  riskTitle: { fontWeight: 600, color: "var(--text-primary)" } as React.CSSProperties,

  severity: { fontSize: 11, fontWeight: 650, textTransform: "uppercase" } as React.CSSProperties,

  fileLink: { background: "none", border: "none", padding: 0, fontFamily: mono, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", textAlign: "left" } as React.CSSProperties,

  focusItem: { display: "block", width: "100%", background: "none", border: "none", padding: "4px 6px", borderRadius: 6, textAlign: "left", font: "inherit", fontSize: 12.5, color: "var(--text-secondary)", cursor: "pointer" } as React.CSSProperties,

  notice: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: "var(--warn)" } as React.CSSProperties,

  error: { display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: "var(--danger, var(--crit))" } as React.CSSProperties,
};
