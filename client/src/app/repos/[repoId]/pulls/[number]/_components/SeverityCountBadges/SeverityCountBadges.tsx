/* SeverityCountBadges — "3 CRITICAL · 5 WARNING · 2 SUGGESTION" row above the
   review-run accordions. Clicking a badge sets it as the active severity
   filter (threaded down into every FindingsPanel); clicking the active badge
   again clears the filter. Purely client-side — no fetch, no LLM. */
"use client";

import React from "react";
import { SeverityBadge } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { countBySeverity, SEVERITY_DISPLAY_ORDER } from "./helpers";

export function SeverityCountBadges({
  findings,
  activeSeverity,
  onChange,
}: {
  findings: FindingRecord[];
  activeSeverity: Severity | null;
  onChange: (severity: Severity | null) => void;
}) {
  const counts = React.useMemo(() => countBySeverity(findings), [findings]);
  const visible = SEVERITY_DISPLAY_ORDER.filter((sev) => counts[sev] > 0);

  if (visible.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {visible.map((sev) => {
        const active = activeSeverity === sev;
        return (
          <button
            key={sev}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : sev)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              borderRadius: 5,
              outline: active ? "2px solid var(--accent)" : "2px solid transparent",
              outlineOffset: 1,
              opacity: activeSeverity && !active ? 0.5 : 1,
            }}
          >
            <SeverityBadge severity={sev} count={counts[sev]} />
          </button>
        );
      })}
    </div>
  );
}
