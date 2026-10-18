"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { DEFAULT_RANGE } from "../constants";
import { presetPeriod, validateCustom, type Period, type PeriodRange, type PeriodSelection } from "../period";
import { s } from "../styles";

const RANGES: readonly PeriodRange[] = ["1d", "30d", "custom"];

export interface PeriodPickerProps {
  value: PeriodSelection;
  /** Presets apply at once (clock read at that moment); Custom applies on the Apply button. */
  onApply: (selection: PeriodSelection, period: Period) => void;
  now?: () => Date;
}

/** Period options shared by the dashboard and the Stats tab (AC-31..AC-34). */
export function PeriodPicker({ value, onApply, now = () => new Date() }: PeriodPickerProps) {
  const t = useTranslations("agentPerformance.period");
  const uid = React.useId();
  const [range, setRange] = React.useState<PeriodRange>(value.range ?? DEFAULT_RANGE);
  const [start, setStart] = React.useState(value.start ?? "");
  const [end, setEnd] = React.useState(value.end ?? "");

  // Follow the controlled value when the URL changes.
  React.useEffect(() => {
    setRange(value.range ?? DEFAULT_RANGE);
    setStart(value.start ?? "");
    setEnd(value.end ?? "");
  }, [value.range, value.start, value.end]);

  const choose = (r: PeriodRange) => {
    setRange(r);
    if (r !== "custom") onApply({ range: r }, presetPeriod(r, now()));
  };

  const check = validateCustom(start, end);
  const reasonId = `${uid}-reason`;

  return (
    <fieldset style={s.picker}>
      <legend style={s.pickerLegend}>{t("label")}</legend>
      <div style={s.pickerRow}>
        {RANGES.map((r) => (
          <label key={r} style={s.option}>
            <input type="radio" name={`${uid}-range`} checked={range === r} onChange={() => choose(r)} />
            {t(`options.${r}`)}
          </label>
        ))}
      </div>
      {range === "custom" && (
        <>
          <div style={s.dates}>
            <label style={s.dateField}>
              {t("start")}
              <input type="date" style={s.dateInput} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label style={s.dateField}>
              {t("end")}
              <input type="date" style={s.dateInput} value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
            <Button
              kind="primary"
              size="sm"
              disabled={!check.ok}
              aria-describedby={check.ok ? undefined : reasonId}
              onClick={() => check.ok && onApply({ range: "custom", start, end }, check.period)}
            >
              {t("apply")}
            </Button>
          </div>
          <p style={s.hint}>{t("utcHint")}</p>
          {!check.ok && (
            <p id={reasonId} style={s.reason}>
              {t(`reason.${check.reason}`)}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
