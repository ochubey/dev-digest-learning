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

  summary: {
    fontSize: 14,
    color: "var(--text-secondary)",
    margin: "12px 0",
  } as React.CSSProperties,

  statsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    margin: "0 0 12px",
  } as React.CSSProperties,

  stat: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 5,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
  } as React.CSSProperties,

  statNum: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } as React.CSSProperties,

  degraded: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    margin: "8px 0 12px",
    fontSize: 12,
    color: "var(--warn)",
  } as React.CSSProperties,

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } as React.CSSProperties,

  symbolHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    border: "none",
    background: "none",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } as React.CSSProperties,

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

  symbolCount: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--text-muted)",
  } as React.CSSProperties,

  callers: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: "6px 0 0 20px",
  } as React.CSSProperties,

  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
  } as React.CSSProperties,

  callerLink: {
    color: "var(--accent)",
    fontFamily: "var(--font-mono, monospace)",
  } as React.CSSProperties,

  chips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: "6px 0 0 20px",
  } as React.CSSProperties,

  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    fontSize: 12,
    borderRadius: 5,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
  } as React.CSSProperties,

  viewToggle: {
    display: "inline-flex",
    marginLeft: "auto",
    padding: 2,
    gap: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-hover)",
  } as React.CSSProperties,

  viewBtn: {
    padding: "2px 10px",
    fontSize: 12,
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
  } as React.CSSProperties,

  viewBtnActive: {
    background: "var(--bg-card, var(--bg-base))",
    color: "var(--text-primary)",
    fontWeight: 600,
  } as React.CSSProperties,

  graphSvg: {
    display: "block",
    width: "100%",
    height: "auto",
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

  muted: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: "4px 0 0 20px",
  } as React.CSSProperties,
} as const;
