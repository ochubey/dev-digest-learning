"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import { focusLabel } from "./helpers";
import { s } from "./styles";

interface ReviewFocusListProps {
  items: ReviewFocusItem[];
  onOpen: (file: string, line: number) => void;
}

/** Review focus points in the order given: `file:line - reason`. */
export function ReviewFocusList({ items, onOpen }: ReviewFocusListProps) {
  const t = useTranslations("brief");
  if (items.length === 0) return <p style={s.muted}>{t("card.noFocus")}</p>;
  return (
    <ul style={s.list}>
      {items.map((item, i) => (
        <li key={`${item.file}:${item.line}:${i}`}>
          <button
            type="button"
            data-testid="focus-item"
            style={s.focusItem}
            onClick={() => onOpen(item.file, item.line)}
          >
            {focusLabel(item)} - {item.reason}
          </button>
          {item.line_adjusted && (
            <span style={s.hint} title={t("card.lineAdjusted")}>
              {t("card.lineAdjusted")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
