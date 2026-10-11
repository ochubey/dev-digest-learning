"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { SIDE_STYLE, s } from "./styles";

export interface EvalDialogProps {
  title: string;
  onClose: () => void;
  /** Slide-in drawer on the right, or a centered dialog. */
  side?: "right" | "center";
  width?: number;
  testId?: string;
  /** Element to focus on close; defaults to whatever had focus when the dialog opened. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

/** Labeled modal dialog: named by its title, closes on Escape / backdrop / Close, moves focus
    in on open and returns it to the element that opened it on close (AC-72). */
export function EvalDialog({ title, onClose, side = "center", width = 720, testId, returnFocusRef, children }: EvalDialogProps) {
  const t = useTranslations("evalsDashboard");
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const returnRef = React.useRef(returnFocusRef);
  returnRef.current = returnFocusRef;

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnRef.current?.current ?? opener)?.focus?.();
    };
  }, []);

  return (
    <div style={{ ...s.root, ...SIDE_STYLE[side].root }}>
      <div style={s.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        style={{ ...s.panel, ...SIDE_STYLE[side].panel, width }}
      >
        <div style={s.header}>
          <h2 id={titleId} style={s.title}>
            {title}
          </h2>
          <Button size="sm" icon="X" onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
        <div style={s.body}>{children}</div>
      </div>
    </div>
  );
}
