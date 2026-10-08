"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { s } from "./styles";

/** One collapsed line for changed symbols nothing calls, instead of a "0 callers" row each. */
export function IdleSymbols({ symbols }: { symbols: DownstreamImpact[] }) {
  const t = useTranslations("blast");
  const [open, setOpen] = useState(false);
  if (symbols.length === 0) return null;
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div data-testid="blast-idle">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.idleHead}>
        <Chevron size={13} />
        {t("idle.title", { count: symbols.length })}
      </button>
      {open && (
        <div style={s.idleChips}>
          {symbols.map((d) => (
            <span key={d.symbol} style={s.idleChip}>
              {d.symbol}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
