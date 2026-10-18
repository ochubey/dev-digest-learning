import { DAY_MS, DEFAULT_RANGE, MAX_RANGE_DAYS, PRESET_DAYS } from "./constants";

/** A half-open `[from, to)` window as UTC ISO-8601 instants (what the API takes and echoes). */
export interface Period {
  from: string;
  to: string;
}

export type PresetRange = keyof typeof PRESET_DAYS;
export type PeriodRange = PresetRange | "custom";

/** What the picker shows and the dashboard URL keeps (`?range=...&start=...&end=...`). */
export interface PeriodSelection {
  range: PeriodRange;
  start?: string;
  end?: string;
  /** Custom window that has no dates to show (not midnight-aligned, not a preset length). */
  opaque?: boolean;
}

export type CustomInvalidReason = "required" | "order" | "tooLong";
export type CustomValidation = { ok: true; period: Period } | { ok: false; reason: CustomInvalidReason };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight of a strict `YYYY-MM-DD` date, or null when it is not a real calendar day. */
function utcDay(value: string | null | undefined): number | null {
  if (!value || !DATE_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

/** `to = now`, `from = now - N days`; the caller passes the clock so it is computed once. */
export function presetPeriod(range: PresetRange, now: Date): Period {
  const to = now.getTime();
  return { from: new Date(to - PRESET_DAYS[range] * DAY_MS).toISOString(), to: new Date(to).toISOString() };
}

/** Start day inclusive, end day inclusive: `to` is 00:00Z of the day after the end date (AC-33). */
export function customPeriod(start: string, end: string): Period {
  const s = utcDay(start);
  const e = utcDay(end);
  if (s === null || e === null) throw new Error("customPeriod: invalid date");
  return { from: new Date(s).toISOString(), to: new Date(e + DAY_MS).toISOString() };
}

export function validateCustom(start: string | null | undefined, end: string | null | undefined): CustomValidation {
  const s = utcDay(start);
  const e = utcDay(end);
  if (s === null || e === null) return { ok: false, reason: "required" };
  if (s > e) return { ok: false, reason: "order" };
  if ((e + DAY_MS - s) / DAY_MS > MAX_RANGE_DAYS) return { ok: false, reason: "tooLong" };
  return { ok: true, period: customPeriod(start as string, end as string) };
}

/** Dashboard URL -> selection + period. Unknown or invalid input falls back to 30 days (AC-36). */
export function parsePeriodParams(
  params: { get(name: string): string | null },
  now: Date,
): { selection: PeriodSelection; period: Period } {
  const range = params.get("range");
  if (range === "1d" || range === "30d") return { selection: { range }, period: presetPeriod(range, now) };
  if (range === "custom") {
    const start = params.get("start");
    const end = params.get("end");
    const v = validateCustom(start, end);
    if (v.ok) return { selection: { range, start: start as string, end: end as string }, period: v.period };
  }
  return { selection: { range: DEFAULT_RANGE }, period: presetPeriod(DEFAULT_RANGE, now) };
}

export function toSearchParams(sel: PeriodSelection): URLSearchParams {
  const sp = new URLSearchParams({ range: sel.range });
  if (sel.range === "custom" && sel.start && sel.end) {
    sp.set("start", sel.start);
    sp.set("end", sel.end);
  }
  return sp;
}

/** Stats tab URL (`from`/`to` instants) -> window; null when absent, invalid or not `from < to`. */
export function parseWindow(from: string | null | undefined, to: string | null | undefined): Period | null {
  if (!from || !to) return null;
  const f = Date.parse(from);
  const t = Date.parse(to);
  if (Number.isNaN(f) || Number.isNaN(t) || f >= t) return null;
  return { from, to };
}

/**
 * Picker selection for an arbitrary window: UTC-midnight aligned windows map back to
 * dates, an exact 1 or 30 day window to that preset, anything else is an opaque Custom.
 */
export function selectionForWindow(p: Period): PeriodSelection {
  const f = Date.parse(p.from);
  const t = Date.parse(p.to);
  if (f % DAY_MS === 0 && t % DAY_MS === 0) {
    return { range: "custom", start: new Date(f).toISOString().slice(0, 10), end: new Date(t - DAY_MS).toISOString().slice(0, 10) };
  }
  for (const range of ["1d", "30d"] as const) {
    if (t - f === PRESET_DAYS[range] * DAY_MS) return { range };
  }
  return { range: "custom", opaque: true };
}
