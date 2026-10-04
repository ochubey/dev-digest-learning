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
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
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

  muted: {
    fontSize: 12,
    color: "var(--text-muted)",
    margin: "4px 0 0 20px",
  } as React.CSSProperties,
} as const;
