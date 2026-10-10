"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, Markdown, Skeleton } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useContextDocPreview } from "@/lib/hooks/project-context";
import { SOURCE_COLOR } from "../constants";
import { formatDocTokens } from "../helpers";
import { s } from "./styles";

export interface ContextDocPreviewDrawerProps {
  repoId: string;
  path: string;
  attached: boolean;
  /** Toggle the attachment (same write as the row checkbox, AC-37). */
  onToggleAttach: () => void;
  onClose: () => void;
  /** Element to refocus on close; defaults to whatever had focus when the drawer opened. */
  returnFocus?: () => HTMLElement | null;
}

const FOCUSABLE = "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/**
 * Read-only preview of one document, as a labelled modal dialog (AC-67). It is
 * feature-local because the vendored `Drawer` has no accessible name, Escape
 * handling or focus return. The body goes through `Markdown`, which never renders raw HTML.
 */
export function ContextDocPreviewDrawer({
  repoId,
  path,
  attached,
  onToggleAttach,
  onClose,
  returnFocus,
}: ContextDocPreviewDrawerProps) {
  const t = useTranslations("projectContext");
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const onCloseRef = React.useRef(onClose);
  const returnFocusRef = React.useRef(returnFocus);
  onCloseRef.current = onClose;
  returnFocusRef.current = returnFocus;

  const q = useContextDocPreview(repoId, path);

  // Move focus into the dialog on open, give it back to the opener on close.
  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      const target = returnFocusRef.current?.() ?? opener;
      if (target?.isConnected) target.focus();
    };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Keep Tab inside the modal.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const data = q.data;
  const notOnMain = q.error instanceof ApiError && q.error.status === 404;

  return (
    <div style={s.overlay}>
      <div style={s.backdrop} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={s.panel}
        onKeyDown={trapTab}
      >
        <div style={s.header}>
          <div style={s.headText}>
            <h2 id={titleId} className="mono" style={s.title}>
              {path}
            </h2>
            {data && (
              <div style={s.subtitle}>
                <span data-testid="context-preview-source">
                  <Badge color={SOURCE_COLOR[data.source]} bg="transparent">
                    {data.source}
                  </Badge>
                </span>
                <span>{t("preview.usedBy", { count: data.used_by })}</span>
                <span>{t("row.tokens", { tokens: formatDocTokens(data.tokens) })}</span>
              </div>
            )}
          </div>
          {data && (
            <Button
              size="sm"
              kind={attached ? "primary" : "secondary"}
              icon={attached ? "Check" : "Plus"}
              aria-pressed={attached}
              onClick={onToggleAttach}
            >
              {attached ? t("preview.attached") : t("preview.attach")}
            </Button>
          )}
          <button
            ref={closeRef}
            type="button"
            style={s.closeBtn}
            aria-label={t("preview.close")}
            title={t("preview.close")}
            onClick={onClose}
          >
            <Icon.X size={16} />
          </button>
        </div>
        <div style={s.body}>
          {q.isPending ? (
            <div role="status" aria-label={t("preview.loading")} style={s.skeleton}>
              <Skeleton height={18} width="40%" />
              <Skeleton />
              <Skeleton />
              <Skeleton width="70%" />
            </div>
          ) : q.isError ? (
            <div role="alert" style={s.state}>
              <span>{notOnMain ? t("preview.notOnMain") : t("preview.error")}</span>
              {!notOnMain && (
                <Button size="sm" icon="RefreshCw" onClick={() => void q.refetch()}>
                  {t("preview.retry")}
                </Button>
              )}
            </div>
          ) : (
            <Markdown>{data?.content}</Markdown>
          )}
        </div>
      </div>
    </div>
  );
}
