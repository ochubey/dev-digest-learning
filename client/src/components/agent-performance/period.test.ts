import { describe, it, expect } from "vitest";
import {
  customPeriod,
  parsePeriodParams,
  parseWindow,
  presetPeriod,
  toSearchParams,
  validateCustom,
} from "./period";

const NOW = new Date("2026-10-18T12:00:00.000Z");

describe("presetPeriod", () => {
  it("1d is [now-1d, now)", () => {
    expect(presetPeriod("1d", NOW)).toEqual({ from: "2026-10-17T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" });
  });
  it("30d is [now-30d, now)", () => {
    expect(presetPeriod("30d", NOW)).toEqual({ from: "2026-09-18T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" });
  });
});

describe("customPeriod", () => {
  it("Sep 1-30 is 09-01T00Z to 10-01T00Z (end day inclusive)", () => {
    expect(customPeriod("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
  });
  it("start = end requests one full UTC day", () => {
    expect(customPeriod("2026-09-05", "2026-09-05")).toEqual({
      from: "2026-09-05T00:00:00.000Z",
      to: "2026-09-06T00:00:00.000Z",
    });
  });
});

describe("validateCustom", () => {
  it("accepts a valid range", () => {
    const r = validateCustom("2026-09-01", "2026-09-30");
    expect(r.ok).toBe(true);
  });
  it("start after end is invalid with reason order", () => {
    expect(validateCustom("2026-09-30", "2026-09-01")).toEqual({ ok: false, reason: "order" });
  });
  it("more than 366 days is invalid with reason tooLong; exactly 366 is fine", () => {
    expect(validateCustom("2025-01-01", "2026-01-02")).toEqual({ ok: false, reason: "tooLong" });
    expect(validateCustom("2025-01-01", "2026-01-01").ok).toBe(true);
  });
  it("missing or malformed dates are invalid with reason required", () => {
    expect(validateCustom("", "2026-09-01")).toEqual({ ok: false, reason: "required" });
    expect(validateCustom("2026-13-40", "2026-09-01")).toEqual({ ok: false, reason: "required" });
    expect(validateCustom("2026-02-30", "2026-03-01")).toEqual({ ok: false, reason: "required" });
  });
});

describe("URL state", () => {
  it("round trips each selection", () => {
    for (const sel of [
      { range: "1d" as const },
      { range: "30d" as const },
      { range: "custom" as const, start: "2026-09-01", end: "2026-09-30" },
    ]) {
      const parsed = parsePeriodParams(new URLSearchParams(toSearchParams(sel).toString()), NOW);
      expect(parsed.selection).toEqual(sel);
    }
  });
  it("derives the period from the selection and the clock", () => {
    expect(parsePeriodParams(new URLSearchParams("range=1d"), NOW).period).toEqual(presetPeriod("1d", NOW));
    expect(parsePeriodParams(new URLSearchParams("range=custom&start=2026-09-01&end=2026-09-30"), NOW).period).toEqual(
      customPeriod("2026-09-01", "2026-09-30"),
    );
  });
  it("no params, unknown range or invalid custom dates fall back to 30d", () => {
    for (const q of ["", "range=7d", "range=custom", "range=custom&start=nope&end=2026-09-30", "range=custom&start=2026-09-30&end=2026-09-01"]) {
      const parsed = parsePeriodParams(new URLSearchParams(q), NOW);
      expect(parsed.selection).toEqual({ range: "30d" });
      expect(parsed.period).toEqual(presetPeriod("30d", NOW));
    }
  });
});

describe("parseWindow (Stats tab from/to)", () => {
  it("returns the exact instants when both are valid and ordered", () => {
    expect(parseWindow("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z")).toEqual({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
  });
  it("returns null for missing, invalid or reversed values", () => {
    expect(parseWindow(null, "2026-10-01T00:00:00.000Z")).toBeNull();
    expect(parseWindow("x", "y")).toBeNull();
    expect(parseWindow("2026-10-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z")).toBeNull();
  });
});
