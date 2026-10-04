"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { DownstreamImpact } from "@devdigest/shared";
import { callerHref } from "./helpers";
import { s } from "./styles";

interface SymbolRowProps {
  impact: DownstreamImpact;
  defaultOpen: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}

/** One changed symbol: a toggle header (name + caller count) over its callers and chips. */
export function SymbolRow({ impact: d, defaultOpen, repoFullName, headSha }: SymbolRowProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? Icon.ChevronDown : Icon.ChevronRight;

  return (
    <div data-testid="blast-symbol">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={s.symbolHead}>
        <Chevron size={13} />
        <Icon.Code size={13} />
        {d.symbol}
        <span style={s.symbolCount}>{t("callerCount", { count: d.callers.length })}</span>
      </button>

      {open && (
        <>
          {d.callers.length === 0 ? (
            <div style={s.muted}>{t("noCallers")}</div>
          ) : (
            <div style={s.callers}>
              {d.callers.map((c) => {
                const href = callerHref(repoFullName, headSha, c.file, c.line);
                const label = `${c.file}:${c.line}`;
                return (
                  <div key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow}>
                    <Icon.CornerDownRight size={12} />
                    <span>{c.name}</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" style={s.callerLink}>
                        {label}
                      </a>
                    ) : (
                      <span style={s.callerLink}>{label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(d.endpoints_affected.length > 0 || d.crons_affected.length > 0) && (
            <div style={s.chips}>
              {d.endpoints_affected.map((e) => (
                <span key={`e:${e}`} data-testid="blast-endpoint" style={s.chip}>
                  <Icon.Globe size={12} />
                  {e}
                </span>
              ))}
              {d.crons_affected.map((c) => (
                <span key={`c:${c}`} data-testid="blast-cron" style={s.chip}>
                  <Icon.Clock size={12} />
                  {c}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
