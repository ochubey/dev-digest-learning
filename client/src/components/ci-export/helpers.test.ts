import { describe, it, expect } from "vitest";
import {
  safeGithubUrl,
  secretsSettingsUrl,
  formatBytes,
  formatDuration,
  formatCost,
  formatTime,
  knownTriggers,
  knownRunStatus,
} from "./helpers";

describe("safeGithubUrl", () => {
  it("accepts https://github.com/ only (rejects javascript:, http://, https://github.com.evil.io)", () => {
    expect(safeGithubUrl("https://github.com/o/r/pull/1")).toBe("https://github.com/o/r/pull/1");
    expect(safeGithubUrl("javascript:alert(1)")).toBeNull();
    expect(safeGithubUrl("http://github.com/o/r")).toBeNull();
    expect(safeGithubUrl("https://github.com.evil.io/o/r")).toBeNull();
    expect(safeGithubUrl("https://github.com@evil.io/o")).toBeNull();
    expect(safeGithubUrl("")).toBeNull();
    expect(safeGithubUrl(null)).toBeNull();
    expect(safeGithubUrl(undefined)).toBeNull();
  });
});

describe("secretsSettingsUrl", () => {
  it("points at the repo's Actions secrets settings", () => {
    expect(secretsSettingsUrl("acme/api")).toBe("https://github.com/acme/api/settings/secrets/actions");
  });
});

describe("formatters", () => {
  it('formatBytes/duration/cost "—" for null', () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatCost(null)).toBe("—");
    expect(formatTime(null)).toBe("—");
  });

  it("formats real values", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatCost(0.0123)).toBe("$0.0123");
    expect(formatCost(2)).toBe("$2.00");
  });

  it("knownTriggers drops unknown values and keeps canonical order", () => {
    expect(knownTriggers(["reopened", "bogus", "opened"])).toEqual(["opened", "reopened"]);
    expect(knownTriggers(null)).toEqual([]);
  });
});

describe("knownRunStatus", () => {
  it("returns known statuses and undefined for anything else", () => {
    expect(knownRunStatus("no_findings")).toBe("no_findings");
    expect(knownRunStatus("weird")).toBeUndefined();
    expect(knownRunStatus(null)).toBeUndefined();
  });
});
