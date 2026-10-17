/* FindingCard — ported from findings.jsx (createElement → TSX).
   Severity icon+label, category, file:line, confidence, markdown rationale +
   suggestion, accept/dismiss actions. Accept/dismiss reflect persisted
   timestamps. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Icon,
  SeverityBadge,
  CategoryTag,
  MonoLink,
  ConfidenceNum,
  Button,
  Markdown,
  type Severity,
  type Category,
} from "@devdigest/ui";
import type { FindingRecord, FindingActionKind } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import { SEV_COLOR, SEV_COLOR_FALLBACK } from "./constants";
import { lineLabel } from "./helpers";
import { EvalCaseDialog } from "../EvalCaseDialog";
import { githubBlobUrl } from "../../../../../../../lib/github-urls";
import { s } from "./styles";

/** Per-call outcome callbacks the card passes to the owner's mutation (used by Learn). */
export interface FindingActionCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function FindingCard({
  f,
  focused,
  muted: mutedProp,
  defaultExpanded,
  onAction,
  pending,
  repoFullName,
  headSha,
}: {
  f: FindingRecord;
  focused?: boolean;
  /** Force the muted look (revealed out-of-scope findings). */
  muted?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string, opts?: FindingActionCallbacks) => void;
  pending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [evalOpen, setEvalOpen] = React.useState(false);
  // The server has no "learned" marker, so the confirmed state lives here for the card's lifetime.
  const [learned, setLearned] = React.useState(false);
  const sevColor = SEV_COLOR[f.severity] ?? SEV_COLOR_FALLBACK;
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  const accepted = !!f.accepted_at;
  const dismissed = !!f.dismissed_at;
  const decided = accepted || dismissed;
  const hintId = React.useId();
  const muted = accepted || dismissed || !!mutedProp;
  const isSignal = f.scope === "signal";
  const isOut = f.scope === "out";

  const learn = () =>
    onAction?.("learn", undefined, {
      onSuccess: () => {
        setLearned(true);
        notify.success(t("finding.learnSuccess"));
      },
      onError: (e) => notify.error(t("finding.learnError", { message: e.message })),
    });

  return (
    <div data-finding-id={f.id} data-scope={f.scope ?? undefined} style={s.card(!!focused, sevColor, muted)}>
      <div onClick={() => setExpanded((e) => !e)} style={s.header}>
        <div style={s.badgeWrap}>
          <SeverityBadge severity={f.severity as Severity} compact />
        </div>
        <div style={s.headerMain}>
          <div style={s.titleRow}>
            <span style={s.title(muted, dismissed)}>{f.title}</span>
            <CategoryTag category={f.category as Category} />
            {accepted && <span style={s.acceptedTag}>{t("finding.accepted")}</span>}
            {dismissed && <span style={s.dismissedTag}>{t("finding.dismissed")}</span>}
            {isOut && <span style={s.outBadge}>{t("scope.outBadge")}</span>}
            {isSignal && <span style={s.signalTag}>{t("scope.signal")}</span>}
          </div>
          {/* scope_reason is model output: plain text node only, never Markdown/HTML. */}
          {isSignal && f.scope_reason && (
            <div data-testid="finding-scope-reason" style={s.scopeReason}>
              {f.scope_reason}
            </div>
          )}
          <div style={s.metaRow}>
            <MonoLink href={fileHref}>
              {f.file}:{lineLabel(f)}
            </MonoLink>
            <ConfidenceNum value={f.confidence} />
          </div>
        </div>
        <Icon.ChevronDown size={16} style={s.chevron(expanded)} />
      </div>

      {expanded && (
        <div style={s.body}>
          <div style={s.prose}>
            <Markdown>{f.rationale}</Markdown>
          </div>
          {f.suggestion && (
            <div style={s.suggestionWrap}>
              <div style={s.suggestionLabel}>{t("finding.suggestedFix")}</div>
              <div style={s.prose}>
                <Markdown>{f.suggestion}</Markdown>
              </div>
            </div>
          )}

          <div style={s.actions}>
            <Button
              kind="secondary"
              size="sm"
              icon="Check"
              disabled={pending}
              active={accepted}
              onClick={() => onAction?.("accept")}
            >
              {t("finding.accept")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="X"
              disabled={pending}
              active={dismissed}
              onClick={() => onAction?.("dismiss")}
            >
              {t("finding.dismiss")}
            </Button>
            <Button
              kind="ghost"
              size="sm"
              icon="Brain"
              disabled={pending || learned}
              active={learned}
              title={learned ? t("finding.learnedTitle") : t("finding.learnTitle")}
              onClick={learn}
            >
              {learned ? t("finding.learned") : t("finding.learn")}
            </Button>
            {/* Capture as an eval case (SPEC-03): only once the finding is accepted or dismissed. */}
            <Button
              kind="ghost"
              size="sm"
              icon="FlaskConical"
              disabled={!decided}
              aria-describedby={decided ? undefined : hintId}
              onClick={() => setEvalOpen(true)}
            >
              {t("finding.turnIntoEvalCase")}
            </Button>
            {!decided && (
              <span id={hintId} style={s.evalHint}>
                {t("finding.turnIntoEvalCaseHint")}
              </span>
            )}
          </div>
          {evalOpen && <EvalCaseDialog findingId={f.id} onClose={() => setEvalOpen(false)} />}
        </div>
      )}
    </div>
  );
}
