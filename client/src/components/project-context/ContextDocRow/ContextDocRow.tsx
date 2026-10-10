"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Button, Checkbox, Icon } from "@devdigest/ui";
import { SOURCE_COLOR } from "../constants";
import { formatDocTokens, type ContextRow } from "../helpers";
import { s } from "./styles";

export interface ContextDocRowProps {
  row: ContextRow;
  /** Move controls for attached rows (keyboard alternative to dragging, AC-19). */
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (path: string) => void;
  onMove: (path: string, delta: -1 | 1) => void;
  onPreview: (path: string) => void;
}

/** One document row. Attached rows are sortable; available and inherited rows are not. */
export function ContextDocRow({
  row,
  canMoveUp,
  canMoveDown,
  onToggle,
  onMove,
  onPreview,
}: ContextDocRowProps) {
  const t = useTranslations("projectContext");
  const sortable = row.kind === "attached";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.key,
    disabled: !sortable,
  });

  const style: React.CSSProperties = {
    ...s.row,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const canPreview = !row.stale && !row.unverified;

  return (
    <div ref={setNodeRef} style={style} data-testid="context-doc-row" data-path={row.path}>
      {row.kind === "inherited" ? (
        <span style={s.lock} title={t("row.inherited")}>
          <Icon.Lock size={14} />
        </span>
      ) : (
        <>
          <span
            data-testid="context-doc-handle"
            style={sortable ? s.handle : s.handleDisabled}
            aria-hidden={!sortable}
            aria-label={sortable ? t("row.handle", { path: row.path }) : undefined}
            {...(sortable ? { ...attributes, ...listeners } : {})}
          >
            <Icon.Menu size={14} />
          </span>
          <Checkbox
            checked={row.attached}
            onChange={() => onToggle(row.path)}
            label={<span style={s.srOnly}>{t("row.attach", { path: row.path })}</span>}
          />
        </>
      )}
      <div style={s.text}>
        <span className="mono" style={s.name} title={row.path}>
          {row.name}
        </span>
        <span data-testid="context-doc-folder" style={s.folder}>
          {row.folder}
        </span>
      </div>
      {row.source && (
        <span data-testid="context-doc-source">
          <Badge color={SOURCE_COLOR[row.source]} bg="transparent">
            {row.source}
          </Badge>
        </span>
      )}
      {row.tokens !== null && !row.stale && (
        <span className="tnum" style={s.tokens}>
          {t("row.tokens", { tokens: formatDocTokens(row.tokens) })}
        </span>
      )}
      {row.stale && <span style={s.state}>{t("row.notFound")}</span>}
      {row.unverified && <span style={s.state}>{t("row.notVerified")}</span>}
      {row.viaSkill && <span style={s.via}>{t("row.via", { skill: row.viaSkill })}</span>}
      {sortable && (
        <>
          <button
            type="button"
            style={s.moveBtn}
            disabled={!canMoveUp}
            aria-label={t("row.moveUp", { path: row.path })}
            onClick={() => onMove(row.path, -1)}
          >
            <Icon.ArrowUp size={14} />
          </button>
          <button
            type="button"
            style={s.moveBtn}
            disabled={!canMoveDown}
            aria-label={t("row.moveDown", { path: row.path })}
            onClick={() => onMove(row.path, 1)}
          >
            <Icon.ArrowDown size={14} />
          </button>
        </>
      )}
      {canPreview && (
        <Button
          size="sm"
          kind="ghost"
          icon="Eye"
          data-testid="context-doc-preview"
          data-path={row.path}
          aria-label={t("row.previewLabel", { path: row.path })}
          onClick={() => onPreview(row.path)}
        >
          {t("row.preview")}
        </Button>
      )}
    </div>
  );
}
