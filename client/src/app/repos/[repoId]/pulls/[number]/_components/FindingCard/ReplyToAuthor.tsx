"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { notify } from "@/lib/toast";
import { useReplyToFinding } from "@/lib/hooks/reviews";
import { s } from "./styles";

/** Reply box under a finding; posts the typed text (plain text, never HTML) as a review comment. */
export function ReplyToAuthor({
  f,
  prId,
  onDone,
}: {
  f: FindingRecord;
  prId: string;
  onDone: () => void;
}) {
  const t = useTranslations("prReview");
  const [text, setText] = React.useState("");
  const reply = useReplyToFinding();
  const blank = text.trim() === "";

  const send = () => {
    reply.mutate(
      { prId, file: f.file, line: f.start_line, body: text },
      {
        onSuccess: () => {
          setText("");
          onDone();
          notify.success(t("finding.replySuccess"));
        },
        onError: (e) => notify.error(t("finding.replyError", { message: e.message })),
      },
    );
  };

  return (
    <div style={s.replyBox}>
      <textarea
        rows={3}
        value={text}
        placeholder={t("finding.replyPlaceholder")}
        aria-label={t("finding.replyToAuthor")}
        onChange={(e) => setText(e.target.value)}
        style={s.replyTextarea}
      />
      <div style={s.replyActions}>
        <Button kind="primary" size="sm" disabled={blank || reply.isPending} onClick={send}>
          {t("finding.sendReply")}
        </Button>
        <Button kind="ghost" size="sm" disabled={reply.isPending} onClick={onDone}>
          {t("finding.cancel")}
        </Button>
      </div>
    </div>
  );
}
