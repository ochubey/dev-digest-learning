import type { CSSProperties } from "react";

export const s = {
  body: { padding: 20, maxHeight: 520, overflow: "auto" } satisfies CSSProperties,
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    lineHeight: 1.6,
    margin: 0,
  } satisfies CSSProperties,
  same: { color: "var(--text-primary)" } satisfies CSSProperties,
  del: {
    color: "var(--crit, #dc2626)",
    background: "rgba(220,38,38,0.12)",
    textDecoration: "line-through",
  } satisfies CSSProperties,
  add: {
    color: "var(--ok, #16a34a)",
    background: "rgba(22,163,74,0.12)",
  } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
