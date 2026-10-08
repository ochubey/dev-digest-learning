import { describe, it, expect } from "vitest";
import type { BlastRadius, Intent } from "@devdigest/shared";
import {
  missingLabels,
  isInDiff,
  focusLabel,
  riskKindIcon,
  riskKindLabelKey,
  inputsChanged,
} from "./helpers";
import { RISK_KIND_ICON, GENERIC_RISK_ICON } from "./constants";

const intent = (over: Partial<Intent> = {}): Intent => ({
  summary: "sum",
  in_scope: ["a", "b"],
  out_of_scope: ["c"],
  confidence: 0.9,
  sources: [],
  ...over,
});
const blast = (files: string[], summary = "bs"): BlastRadius => ({
  changed_symbols: [],
  downstream: [
    {
      symbol: "f",
      callers: files.map((file) => ({ name: "n", file, line: 1 })),
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary,
});

describe("missingLabels", () => {
  it("maps inputs through the translator, keeping order", () => {
    expect(missingLabels(["intent", "blast"], (k) => `L:${k}`)).toEqual(["L:intent", "L:blast"]);
  });
  it("is empty for no missing inputs", () => {
    expect(missingLabels([], (k) => k)).toEqual([]);
  });
});

describe("isInDiff", () => {
  it("matches exact paths only", () => {
    const paths = new Set(["src/a.ts"]);
    expect(isInDiff("src/a.ts", paths)).toBe(true);
    expect(isInDiff("src/b.ts", paths)).toBe(false);
    expect(isInDiff("a.ts", paths)).toBe(false);
  });
});

describe("focusLabel", () => {
  it("formats file:line", () => {
    expect(focusLabel({ file: "src/a.ts", line: 12 })).toBe("src/a.ts:12");
  });
});

describe("riskKindIcon", () => {
  it("maps every known kind", () => {
    for (const k of Object.keys(RISK_KIND_ICON)) expect(riskKindIcon(k)).toBe(RISK_KIND_ICON[k]);
  });
  it("falls back to the generic icon for an unknown kind (AC-80)", () => {
    expect(riskKindIcon("mystery")).toBe(GENERIC_RISK_ICON);
  });
  it("falls back to riskKind.unknown for an unknown label key", () => {
    expect(riskKindLabelKey("security")).toBe("riskKind.security");
    expect(riskKindLabelKey("mystery")).toBe("riskKind.unknown");
  });
});

describe("inputsChanged", () => {
  const snap = { intent: intent(), blast: blast(["x.ts", "y.ts"]) };

  it("is false when live matches the snapshot", () => {
    expect(inputsChanged(snap, intent(), blast(["x.ts", "y.ts"]))).toBe(false);
  });
  it("is true for a null snapshot with live intent (AC-78)", () => {
    expect(inputsChanged({ intent: null, blast: snap.blast }, intent(), snap.blast)).toBe(true);
  });
  it("is true for a null snapshot blast with live blast", () => {
    expect(inputsChanged({ intent: snap.intent, blast: null }, snap.intent, blast(["x.ts"]))).toBe(true);
  });
  it("is true when the live input disappeared", () => {
    expect(inputsChanged(snap, null, snap.blast)).toBe(true);
    expect(inputsChanged(snap, snap.intent, null)).toBe(true);
  });
  it("is false when both are absent", () => {
    expect(inputsChanged({ intent: null, blast: null }, null, undefined)).toBe(false);
  });
  it("ignores caller reordering and duplicates (AC-78)", () => {
    expect(inputsChanged(snap, intent(), blast(["y.ts", "x.ts", "x.ts"]))).toBe(false);
  });
  it("ignores scope item order", () => {
    expect(inputsChanged(snap, intent({ in_scope: ["b", "a"] }), snap.blast)).toBe(false);
  });
  it("detects summary, scope and caller-file changes", () => {
    expect(inputsChanged(snap, intent({ summary: "other" }), snap.blast)).toBe(true);
    expect(inputsChanged(snap, intent({ in_scope: ["a"] }), snap.blast)).toBe(true);
    expect(inputsChanged(snap, intent({ out_of_scope: [] }), snap.blast)).toBe(true);
    expect(inputsChanged(snap, intent(), blast(["x.ts", "z.ts"]))).toBe(true);
    expect(inputsChanged(snap, intent(), blast(["x.ts", "y.ts"], "changed"))).toBe(true);
  });
  it("a snapshot truncated at the caller cap is not 'changed' (25 of 40 live)", () => {
    const live = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    expect(inputsChanged({ intent: null, blast: blast(live.slice(0, 25)) }, null, blast(live))).toBe(false);
  });
  it("a snapshot below the cap must match the live callers (3 vs 4)", () => {
    expect(inputsChanged({ intent: null, blast: blast(["a", "b", "c"]) }, null, blast(["a", "b", "c", "d"]))).toBe(true);
  });
  it("a capped snapshot with a caller missing from live is changed", () => {
    const live = Array.from({ length: 40 }, (_, i) => `f${i}.ts`);
    const snapFiles = [...live.slice(0, 24), "gone.ts"];
    expect(inputsChanged({ intent: null, blast: blast(snapFiles) }, null, blast(live))).toBe(true);
  });
  it("reordered callers are not a change", () => {
    expect(inputsChanged({ intent: null, blast: blast(["a", "b", "c"]) }, null, blast(["c", "a", "b"]))).toBe(false);
  });
  it("ignores fields outside the compared set (confidence, sources)", () => {
    expect(inputsChanged(snap, intent({ confidence: 0.1 }), snap.blast)).toBe(false);
  });
});
