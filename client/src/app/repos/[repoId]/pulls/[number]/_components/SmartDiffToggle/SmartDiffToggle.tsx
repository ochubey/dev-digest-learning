/* SmartDiffToggle — "Original order" switch: on = flat GitHub-order list. */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";

interface SmartDiffToggleProps {
  originalOrder: boolean;
  onToggle: () => void;
}

export function SmartDiffToggle({ originalOrder, onToggle }: SmartDiffToggleProps) {
  const t = useTranslations("prReview");
  return (
    <Button
      kind="ghost"
      size="sm"
      icon="Layers"
      active={originalOrder}
      aria-pressed={originalOrder}
      onClick={onToggle}
    >
      {t("smartDiff.originalOrder")}
    </Button>
  );
}
