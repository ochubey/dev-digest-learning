import React from "react";

export const s = {
  wrap: {
    marginBottom: 20,
  } as React.CSSProperties,

  deriveError: {
    fontSize: 13,
    color: "var(--crit)",
    marginTop: 8,
  } as React.CSSProperties,

  summary: {
    fontSize: 14,
    fontStyle: "italic",
    color: "var(--text-secondary)",
    margin: "12px 0",
    padding: "8px 12px",
    backgroundColor: "var(--bg-hover)",
    borderRadius: 6,
    borderLeft: "3px solid var(--accent)",
  } as React.CSSProperties,

  columnsWrap: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
    margin: "16px 0",
  } as React.CSSProperties,

  column: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,

  columnLabel: {
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    color: "var(--text-muted)",
    marginBottom: 4,
  } as React.CSSProperties,

  scopeItems: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } as React.CSSProperties,

  scopeItem: {
    fontSize: 13,
    color: "var(--text-primary)",
  } as React.CSSProperties,

  sourcesWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: "12px 0",
  } as React.CSSProperties,

  sourceChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 5,
    background: "var(--bg-hover)",
    border: "1px solid var(--border)",
  } as React.CSSProperties,

  sourceLabel: {
    flex: 1,
  } as React.CSSProperties,

  sourceReason: {
    fontSize: 11,
  } as React.CSSProperties,

  sourceIcon: {
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  footerWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    margin: "12px 0 0 0",
    paddingTop: 12,
    borderTop: "1px solid var(--border)",
    gap: 12,
  } as React.CSSProperties,

  confidenceWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,

  staleBadgeWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,

  loadingWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "12px 0",
  } as React.CSSProperties,

  columnTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 8,
  } as React.CSSProperties,
} as const;
