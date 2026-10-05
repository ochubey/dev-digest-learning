/* SmartDiffToggle — Smart order / Original order segmented switch. */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";

interface SmartDiffToggleProps {
  originalOrder: boolean;
  onChange: (originalOrder: boolean) => void;
}

export function SmartDiffToggle({ originalOrder, onChange }: SmartDiffToggleProps) {
  const t = useTranslations("prReview");
  return (
    <>
      <Button
        kind={originalOrder ? "ghost" : "primary"}
        size="sm"
        aria-pressed={!originalOrder}
        onClick={() => onChange(false)}
      >
        {t("smartDiff.smartOrder")}
      </Button>
      <Button
        kind={originalOrder ? "primary" : "ghost"}
        size="sm"
        aria-pressed={originalOrder}
        onClick={() => onChange(true)}
      >
        {t("smartDiff.originalOrder")}
      </Button>
    </>
  );
}
