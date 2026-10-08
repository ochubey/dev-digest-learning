import React from "react";

export const s = {
  wrap: {
    marginBottom: 20,
  } as React.CSSProperties,

  loadingWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 0",
  } as React.CSSProperties,

  summary: { fontSize: 12.5, color: "var(--text-secondary)", margin: "0 0 10px" } as React.CSSProperties,

  statsRow: { display: "flex", alignItems: "center", marginBottom: 10 } as React.CSSProperties,

  stat: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary)", fontSize: 12.5 } as React.CSSProperties,

  statNum: { color: "var(--text-primary)", fontWeight: 650, fontVariantNumeric: "tabular-nums" } as React.CSSProperties,

  degraded: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: "8px 0 12px",
    fontSize: 12,
    color: "var(--warn)",
  } as React.CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 2 } as React.CSSProperties,

  symbolHead: { display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "5px 6px", borderRadius: 6, border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "var(--text-primary)" } as React.CSSProperties,

  resyncWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  } as React.CSSProperties,

  resyncError: {
    fontSize: 12,
    color: "var(--danger, var(--warn))",
  } as React.CSSProperties,

  symbolCount: { fontSize: 11, fontWeight: 400, color: "var(--text-muted)", marginLeft: "auto" } as React.CSSProperties,

  callers: { padding: "4px 0 8px 14px" } as React.CSSProperties,

  callerRow: { display: "flex", alignItems: "center", gap: 7, padding: "3px 0 3px 18px", position: "relative", fontSize: 12.5 } as React.CSSProperties,

  callerLink: { background: "none", border: "none", padding: 0, fontFamily: "var(--font-mono, monospace)", fontSize: 12, color: "var(--text-secondary)", textDecoration: "none", textUnderlineOffset: 2, cursor: "pointer" } as React.CSSProperties,

  chips: { display: "flex", gap: 6, flexWrap: "wrap", padding: "8px 0 2px 18px" } as React.CSSProperties,

  chip: { display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 5, fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-mono, monospace)", lineHeight: 1.4, whiteSpace: "nowrap" } as React.CSSProperties,

  viewToggle: { marginLeft: "auto", display: "flex", gap: 2, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 7, padding: 2 } as React.CSSProperties,

  viewBtn: { padding: "3px 10px", fontSize: 11.5, fontWeight: 600, borderRadius: 5, border: "none", textTransform: "capitalize", background: "transparent", color: "var(--text-muted)", cursor: "pointer" } as React.CSSProperties,

  viewBtnActive: { background: "var(--bg-elevated)", color: "var(--text-primary)" } as React.CSSProperties,

  graphSvg: {
    display: "block",
    width: "100%",
    height: "auto",
  } as React.CSSProperties,

  graphNote: {
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,

  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 3,
    border: "2px solid var(--accent)",
  } as React.CSSProperties,

  priorWrap: { border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" } as React.CSSProperties,

  priorHead: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" } as React.CSSProperties,

  priorCount: { padding: "2px 8px", borderRadius: 5, fontSize: 11.5, fontWeight: 600, lineHeight: 1.4, color: "var(--text-secondary)", background: "var(--bg-hover)" } as React.CSSProperties,

  priorList: { display: "flex", flexDirection: "column", gap: 10, padding: "4px 12px 12px" } as React.CSSProperties,

  priorItem: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 13,
    color: "var(--text-primary)",
  } as React.CSSProperties,

  priorTitleRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
  } as React.CSSProperties,

  priorMeta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  priorFiles: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  } as React.CSSProperties,

  priorFile: {
    padding: "1px 6px",
    fontSize: 12,
    borderRadius: 4,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
  } as React.CSSProperties,

  idleHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  idleChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: "8px 0 0 20px",
  } as React.CSSProperties,

  idleChip: {
    padding: "1px 6px",
    fontSize: 12,
    borderRadius: 4,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
  } as React.CSSProperties,

  showAll: {
    alignSelf: "flex-start",
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    color: "var(--accent)",
  } as React.CSSProperties,

  muted: { fontSize: 12, color: "var(--text-muted)", padding: "4px 0 8px 32px" } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 } as React.CSSProperties,
  headerLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)" } as React.CSSProperties,
  statsGroup: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" } as React.CSSProperties,
  statIcon: { color: "var(--text-muted)" } as React.CSSProperties,
  symbolName: { fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, fontWeight: 600 } as React.CSSProperties,
  connV: { position: "absolute", left: 8, top: 0, bottom: 0, width: 1, background: "var(--border-strong)" } as React.CSSProperties,
  connH: { position: "absolute", left: 8, top: "50%", width: 8, height: 1, background: "var(--border-strong)" } as React.CSSProperties,
  cronChips: { display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0 2px 18px" } as React.CSSProperties,
  chipEndpoint: { color: "var(--accent-text)", background: "var(--accent-bg)" } as React.CSSProperties,
  chipCron: { color: "var(--warn)", background: "var(--warn-bg)" } as React.CSSProperties,
  divider: { height: 1, background: "var(--border)", margin: "16px 0" } as React.CSSProperties,
} as const;
