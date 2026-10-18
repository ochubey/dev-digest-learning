"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { s } from "../styles";

/**
 * The "Estimate" tag every cost amount carries (AC-58). It is a button so it is
 * reachable by keyboard; focus or hover shows the legend, Escape closes it.
 */
export function EstimateLabel() {
  const t = useTranslations("agentPerformance.cost");
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  return (
    <span style={s.estimateWrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        style={s.estimateBtn}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        {t("estimate")}
      </button>
      {open && (
        <span id={id} role="tooltip" style={s.legend}>
          {t("legend")}
        </span>
      )}
    </span>
  );
}
