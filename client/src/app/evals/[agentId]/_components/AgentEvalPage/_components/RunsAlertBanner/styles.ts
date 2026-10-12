import type React from "react";

export const s: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    padding: "10px 14px",
    fontSize: 13,
    color: "var(--text-primary)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 8,
  },
  icon: { color: "var(--warn)", flexShrink: 0, marginTop: 1 },
  text: { margin: 0 },
};
