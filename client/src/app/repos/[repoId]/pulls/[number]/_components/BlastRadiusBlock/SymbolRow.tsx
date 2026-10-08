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
  /** Kind of the changed symbol; functions and methods are shown as `name()`. */
  kind?: string;
  repoFullName?: string | null;
  headSha?: string | null;
}

const CALLABLE = new Set(["function", "method"]);

/** One changed symbol: a toggle header (name + caller count) over its callers and chips. */
export function SymbolRow({ impact: d, defaultOpen, kind, repoFullName, headSha }: SymbolRowProps) {
  const t = useTranslations("blast");
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-testid="blast-symbol" style={{ borderRadius: 6 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...s.symbolHead, background: open ? "var(--bg-hover)" : "transparent" }}
      >
        <Icon.ChevronRight
          size={13}
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform .12s",
          }}
        />
        <Icon.Code size={13} style={{ color: "var(--accent)" }} />
        <span style={s.symbolName}>
          <span>{d.symbol}</span>
          {kind && CALLABLE.has(kind) && <span>()</span>}
        </span>
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
                  <div key={`${c.file}:${c.line}:${c.name}`} style={s.callerRow} title={c.name}>
                    <span style={s.connV} />
                    <span style={s.connH} />
                    <Icon.CornerDownRight size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
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

          {d.endpoints_affected.length > 0 && (
            <div style={s.chips}>
              {d.endpoints_affected.map((e) => (
                <span key={`e:${e}`} data-testid="blast-endpoint" style={{ ...s.chip, ...s.chipEndpoint }}>
                  <Icon.Globe size={12} style={{ flexShrink: 0 }} />
                  {e}
                </span>
              ))}
            </div>
          )}
          {d.crons_affected.length > 0 && (
            <div style={s.cronChips}>
              {d.crons_affected.map((c) => (
                <span key={`c:${c}`} data-testid="blast-cron" style={{ ...s.chip, ...s.chipCron }}>
                  <Icon.Clock size={12} style={{ flexShrink: 0 }} />
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
