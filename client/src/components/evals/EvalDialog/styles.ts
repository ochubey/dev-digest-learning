import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  root: { position: "fixed", inset: 0, zIndex: 50, display: "flex" },
  backdrop: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" },
  panel: {
    position: "relative",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    boxShadow: "var(--shadow-modal)",
    display: "flex",
    flexDirection: "column",
    outline: "none",
    maxWidth: "96%",
  },
  header: { display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--border)" },
  title: { flex: 1, margin: 0, fontSize: 16, fontWeight: 700 },
  body: { flex: 1, overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 },
};

export const SIDE_STYLE: Record<"right" | "center", { root: React.CSSProperties; panel: React.CSSProperties }> = {
  right: {
    root: { justifyContent: "flex-end" },
    panel: { height: "100%", borderLeft: "1px solid var(--border-strong)" },
  },
  center: {
    root: { justifyContent: "center", alignItems: "center", padding: 28 },
    panel: { maxHeight: "92%", borderRadius: 14 },
  },
};
