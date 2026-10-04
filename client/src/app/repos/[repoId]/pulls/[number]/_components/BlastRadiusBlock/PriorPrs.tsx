"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { usePrHistory } from "@/lib/hooks/blast";
import { githubPrUrl } from "@/lib/github-urls";
import { HISTORY_FILES_SHOWN } from "./constants";
import { s } from "./styles";

interface PriorPrsProps {
  prId: string;
  repoFullName?: string | null;
}

/** "Prior PRs touching these files": collapsed by default, count always visible. */
export function PriorPrs({ prId, repoFullName }: PriorPrsProps) {
  const t = useTranslations("blast");
  const { data, isLoading, error } = usePrHistory(prId);
  const [open, setOpen] = useState(false);

  if (isLoading) return null;
  const items = data?.history ?? [];

  return (
    <div data-testid="blast-prior-prs" style={s.priorWrap}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={s.priorHead}
      >
        <Icon.History size={14} />
        {t("priorPrs.title")}
        <span style={s.priorCount}>{items.length}</span>
        <span style={{ marginLeft: "auto" }}>
          {open ? <Icon.ChevronDown size={14} /> : <Icon.ChevronRight size={14} />}
        </span>
      </button>

      {open &&
        (error ? (
          <div style={s.muted}>{t("priorPrs.error")}</div>
        ) : items.length === 0 ? (
          <div style={s.muted}>{t("priorPrs.empty")}</div>
        ) : (
          <div style={s.priorList}>
            <div style={s.priorMeta}>{t("priorPrs.scope")}</div>
            {items.map((p) => {
              const shown = p.files_overlap.slice(0, HISTORY_FILES_SHOWN);
              const more = p.files_overlap.length - shown.length;
              const label = `#${p.pr_number}`;
              return (
                <div key={p.pr_number} data-testid="blast-prior-pr" style={s.priorItem}>
                  <div style={s.priorTitleRow}>
                    {repoFullName ? (
                      <a
                        href={githubPrUrl(repoFullName, p.pr_number)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={s.callerLink}
                      >
                        {label}
                      </a>
                    ) : (
                      <span style={s.callerLink}>{label}</span>
                    )}
                    <span>{p.title}</span>
                  </div>
                  <div style={s.priorMeta}>
                    {t("priorPrs.mergedBy", {
                      author: p.author,
                      date: new Date(p.merged_at).toLocaleDateString("en", { dateStyle: "medium" }),
                    })}
                  </div>
                  <div style={s.priorFiles}>
                    {shown.map((f) => (
                      <span key={f} style={s.priorFile}>
                        {f}
                      </span>
                    ))}
                    {more > 0 && <span style={s.priorMeta}>{t("priorPrs.moreFiles", { count: more })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
