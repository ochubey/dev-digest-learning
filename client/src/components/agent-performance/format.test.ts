import { describe, it, expect } from "vitest";
import { EM_DASH, formatDateTime, formatDuration, formatPeriod, formatRate, formatShare, formatUsd } from "./format";

describe("formatUsd", () => {
  it("never shows $0.00 for a positive amount", () => {
    expect(formatUsd(0.0004)).toBe("$0.0004");
    expect(formatUsd(0.00001)).toBe("<$0.0001");
  });
  it("uses two decimals from one cent up", () => {
    expect(formatUsd(0.0123)).toBe("$0.01");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
  it("a real zero is $0.00 and null is an em dash", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(null)).toBe(EM_DASH);
  });
});

describe("formatDuration", () => {
  it("seconds with one decimal under a minute", () => {
    expect(formatDuration(14200)).toBe("14.2 s");
  });
  it("minutes and zero-padded seconds from a minute", () => {
    expect(formatDuration(65000)).toBe("1 m 05 s");
    expect(formatDuration(60000)).toBe("1 m 00 s");
  });
  it("does not print 60.0 s at the boundary", () => {
    expect(formatDuration(59990)).toBe("1 m 00 s");
  });
  it("null is an em dash", () => {
    expect(formatDuration(null)).toBe(EM_DASH);
  });
});

describe("formatRate / formatShare", () => {
  it("rate is a whole percent, null is an em dash", () => {
    expect(formatRate(0.75)).toBe("75%");
    expect(formatRate(1)).toBe("100%");
    expect(formatRate(null)).toBe(EM_DASH);
  });
  it("share under 1% is marked rather than 0%", () => {
    expect(formatShare(0.004)).toBe("<1%");
    expect(formatShare(1 / 3)).toBe("33%");
  });
});

describe("dates", () => {
  it("formats UTC instants", () => {
    expect(formatDateTime("2026-10-18T09:30:00.000Z")).toBe("2026-10-18 09:30 UTC");
    expect(formatDateTime(null)).toBe(EM_DASH);
  });
  it("formats a period", () => {
    expect(formatPeriod({ from: "2026-09-18T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" })).toBe(
      "2026-09-18 12:00 UTC – 2026-10-18 12:00 UTC",
    );
  });
});
