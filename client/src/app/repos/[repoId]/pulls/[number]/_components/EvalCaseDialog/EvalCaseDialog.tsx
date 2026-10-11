/* EvalCaseDialog — review step of "Turn into eval case" (SPEC-03 AC-3..AC-14).
   Opens with a read-only draft from the server and stores nothing until Save. Feature-local
   dialog because the vendored Modal/Drawer have no accessible name, Escape handling or focus
   return. Every string from the case or the finding is rendered as a plain text node (AC-83);
   the diff fragment goes in a <pre>. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button, Icon, Skeleton } from "@devdigest/ui";
import type { EvalCaseDraft, EvalExpectationKind } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateEvalCase, useEvalCaseDraft } from "@/lib/hooks/evals";
import { EVAL_CASE_NAME_MAX } from "@/components/evals/constants";
import { effectiveAgentId, evalsTabHref, existingCaseId, formatRange } from "./helpers";
import { s } from "./styles";

export interface EvalCaseDialogProps {
  findingId: string;
  onClose: () => void;
}

const FOCUSABLE = "button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export function EvalCaseDialog({ findingId, onClose }: EvalCaseDialogProps) {
  const t = useTranslations("prReview.evalCaseDialog");
  const titleId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const draft = useEvalCaseDraft(findingId, { enabled: true });

  // Move focus into the dialog on open, give it back to the opener on close.
  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
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
          <h2 id={titleId} style={s.title}>
            {t("title")}
          </h2>
          <button ref={closeRef} type="button" style={s.closeBtn} aria-label={t("close")} title={t("close")} onClick={onClose}>
            <Icon.X size={16} />
          </button>
        </div>
        {draft.isPending ? (
          <div style={s.body}>
            <div role="status" aria-label={t("loading")}>
              <Skeleton height={18} width="40%" />
              <Skeleton />
              <Skeleton width="70%" />
            </div>
          </div>
        ) : draft.isError ? (
          <div style={s.body}>
            <div role="alert" style={s.state}>
              <span>{draft.error instanceof ApiError ? draft.error.message : t("loadError")}</span>
              <Button size="sm" icon="RefreshCw" onClick={() => void draft.refetch()}>
                {t("retry")}
              </Button>
            </div>
          </div>
        ) : (
          <EvalCaseForm draft={draft.data} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function EvalCaseForm({ draft, onClose }: { draft: EvalCaseDraft; onClose: () => void }) {
  const t = useTranslations("prReview.evalCaseDialog");
  const ids = { name: React.useId(), agent: React.useId(), notes: React.useId(), fragment: React.useId() };
  const agents = useAgents();
  const create = useCreateEvalCase();

  const [name, setName] = React.useState(draft.name);
  const [kind, setKind] = React.useState<EvalExpectationKind>(draft.expectation.kind);
  const [notes, setNotes] = React.useState("");
  const [picked, setPicked] = React.useState("");
  const [savedAgentId, setSavedAgentId] = React.useState<string | null>(null);

  const agentId = effectiveAgentId(draft, picked);
  const existing = existingCaseId(draft, agentId);
  const agentName = agents.data?.find((a) => a.id === draft.agent_id)?.name ?? draft.agent_id;
  const canSave = !!name.trim() && !!agentId && !existing && !create.isPending;

  const save = () => {
    if (!canSave) return;
    create.mutate(
      {
        agent_id: agentId,
        finding_id: draft.finding_id,
        name: name.trim(),
        expectation: { ...draft.expectation, kind },
        input_diff: draft.input_diff,
        notes: notes.trim() || null,
      },
      { onSuccess: () => setSavedAgentId(agentId) },
    );
  };

  if (savedAgentId) {
    return (
      <>
        <div style={s.body}>
          <div role="status" style={s.notice}>
            <Icon.Check size={16} />
            <span>{t("saved")}</span>
            <Link href={evalsTabHref(savedAgentId)} style={s.link}>
              {t("viewEvals")}
            </Link>
          </div>
        </div>
        <div style={s.footer}>
          <Button kind="primary" onClick={onClose}>
            {t("close")}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={s.body}>
        <div style={s.field}>
          <label htmlFor={ids.name} style={s.label}>
            {t("name")}
          </label>
          <input
            id={ids.name}
            value={name}
            maxLength={EVAL_CASE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            style={s.select}
          />
        </div>

        <div style={s.field} role="radiogroup" aria-label={t("kind")}>
          <span style={s.label}>{t("kind")}</span>
          <div style={s.radioRow}>
            {(["must_find", "must_not_flag"] as const).map((k) => (
              <label key={k} style={s.radio}>
                <input
                  type="radio"
                  name="eval-case-kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                />
                {k === "must_find" ? t("kindMustFind") : t("kindMustNotFlag")}
              </label>
            ))}
          </div>
          {kind === "must_not_flag" && <div style={s.hint}>{t("dismissedHint")}</div>}
        </div>

        <div style={s.readOnly}>
          <div>
            <span style={s.label}>{t("file")}</span>
            <span className="mono" style={s.readOnlyValue}>
              {draft.expectation.file}
            </span>
          </div>
          <div>
            <span style={s.label}>{t("lines")}</span>
            <span className="mono" style={s.readOnlyValue}>
              {formatRange(draft.expectation.start_line, draft.expectation.end_line)}
            </span>
          </div>
        </div>

        <div style={s.field}>
          <span id={ids.fragment} style={s.label}>
            {t("fragment")}
          </span>
          <pre aria-labelledby={ids.fragment} tabIndex={0} className="mono" style={s.fragment}>
            {draft.input_diff}
          </pre>
        </div>

        <div style={s.field}>
          {draft.agent_id ? (
            <>
              <span style={s.label}>{t("agent")}</span>
              <span style={s.readOnlyValue}>{agentName}</span>
            </>
          ) : (
            <>
              <label htmlFor={ids.agent} style={s.label}>
                {t("agent")}
              </label>
              <select id={ids.agent} value={picked} onChange={(e) => setPicked(e.target.value)} style={s.select}>
                <option value="">{t("agentPlaceholder")}</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <div style={s.hint}>{t("agentPick")}</div>
            </>
          )}
        </div>

        <div style={s.field}>
          <label htmlFor={ids.notes} style={s.label}>
            {t("notes")}
          </label>
          <textarea
            id={ids.notes}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={s.textarea}
          />
        </div>

        {existing && (
          <div role="status" style={s.notice}>
            <span>{t("alreadyExists")}</span>
            <Link href={evalsTabHref(agentId)} style={s.link}>
              {t("viewExisting")}
            </Link>
          </div>
        )}
        {create.isError && (
          <div role="alert" style={s.error}>
            {t("saveError")}
          </div>
        )}
      </div>
      <div style={s.footer}>
        <Button kind="ghost" onClick={onClose}>
          {t("cancel")}
        </Button>
        {!existing && (
          <Button kind="primary" disabled={!canSave} loading={create.isPending} onClick={save}>
            {create.isPending ? t("saving") : t("save")}
          </Button>
        )}
      </div>
    </>
  );
}
