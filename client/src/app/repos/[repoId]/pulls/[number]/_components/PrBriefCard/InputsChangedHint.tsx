"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Icon } from "@devdigest/ui";
import { ApiError } from "@/lib/api";
import { useGenerateBrief, useIsGeneratingBrief, type BriefResponse } from "@/lib/hooks/brief";
import { useIntent } from "@/lib/hooks/reviews";
import { useBlastRadius } from "@/lib/hooks/blast";
import { inputsChanged } from "./helpers";
import { useCooldown } from "./useCooldown";
import { GenerateNotice } from "./GenerateNotice";
import { s } from "./styles";

/** Advisory (D-2): the live Intent / Blast Radius moved since the brief snapshotted them.
 *  Never hides the brief; evaluated only once both live queries have settled. */
export function InputsChangedHint({ prId, brief }: { prId: string; brief: BriefResponse }) {
  const t = useTranslations("brief");
  const intent = useIntent(prId);
  const blast = useBlastRadius(prId);
  const generate = useGenerateBrief(prId);
  // Disabled while any generation for this PR runs, including the card header's.
  const generating = useIsGeneratingBrief(prId);
  const pending = generate.isPending || generating;
  const cooling = useCooldown(prId) > 0;

  const settled = !intent.isPending && !intent.isFetching && !blast.isPending && !blast.isFetching;
  if (!settled) return null;
  // Unknown live state (non-404 intent error, blast error/degraded) is not "absent": do not flag it.
  const intentUnknown = !!intent.error && !(intent.error instanceof ApiError && intent.error.status === 404);
  const blastUnknown = !blast.data || blast.data.degraded;
  const liveIntent = intentUnknown ? brief.intent : (intent.data ?? null);
  const liveBlast = blastUnknown ? brief.blast : blast.data;
  if (!inputsChanged(brief, liveIntent, liveBlast)) return null;

  return (
    <>
      <div role="status" style={s.notice}>
        <Icon.Info size={14} />
        {t("card.inputsChanged")}
        <Button
          size="sm"
          kind="ghost"
          icon="RefreshCw"
          disabled={pending || cooling}
          onClick={() => generate.mutate()}
        >
          {pending ? t("card.regenerating") : t("card.regenerate")}
        </Button>
      </div>
      <GenerateNotice prId={prId} showCooldown={false} error={generate.error} pending={pending} onRetry={() => generate.mutate()} />
    </>
  );
}
