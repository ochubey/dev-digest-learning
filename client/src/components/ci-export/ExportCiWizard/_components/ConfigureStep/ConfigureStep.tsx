"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { CiFailOn, CiPostAs, CiTrigger } from "@devdigest/shared";
import { CI_TRIGGERS, POST_AS_VALUES } from "../../../constants";
import { s } from "../../styles";

export interface ConfigureStepProps {
  triggers: CiTrigger[];
  onTriggers: (next: CiTrigger[]) => void;
  postAs: CiPostAs;
  onPostAs: (next: CiPostAs) => void;
  /** The agent's current CI gate policy (read-only here; edited in the CI tab). */
  failOn: CiFailOn;
}

/** Step 3: triggers, how results are posted, and the Fail CI on reminder (AC-31..AC-34). */
export function ConfigureStep({ triggers, onTriggers, postAs, onPostAs, failOn }: ConfigureStepProps) {
  const t = useTranslations("ciExport.configure");
  const tTab = useTranslations("ciExport.tab");
  const toggle = (tr: CiTrigger) =>
    onTriggers(triggers.includes(tr) ? triggers.filter((x) => x !== tr) : [...triggers, tr]);
  return (
    <>
      <fieldset style={s.group}>
        <legend style={s.legend}>{t("triggers")}</legend>
        {CI_TRIGGERS.map((tr) => (
          <label key={tr} style={s.option}>
            <input type="checkbox" checked={triggers.includes(tr)} onChange={() => toggle(tr)} />
            {t(`trigger.${tr}`)}
          </label>
        ))}
        {triggers.length === 0 && (
          <p style={s.error} role="alert">
            {t("pickOne")}
          </p>
        )}
      </fieldset>

      <fieldset style={s.group}>
        <legend style={s.legend}>{t("postAs")}</legend>
        {POST_AS_VALUES.map((v) => (
          <label key={v} style={s.option}>
            <input type="radio" name="ci-post-as" checked={postAs === v} onChange={() => onPostAs(v)} />
            {t(`postOptions.${v}`)}
          </label>
        ))}
      </fieldset>

      <p style={s.hint}>
        {tTab("failOn")}: <strong>{tTab(`failOnOptions.${failOn}`)}</strong>
      </p>
      <div style={{ ...s.note, display: "flex", gap: 10 }}>
        <Icon.Info size={15} />
        <span>{t("blockNote")}</span>
      </div>
    </>
  );
}
