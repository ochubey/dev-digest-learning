import { describe, it, expect } from "vitest";
import { formatDuration } from "./format-duration";

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(125_000)).toBe("2:05");
  });

  it("pads zero seconds", () => {
    expect(formatDuration(60_000)).toBe("1:00");
  });
});
