import { describe, it, expect } from "vitest";
import agentPerformance from "../../messages/en/agentPerformance.json";
import runs from "../../messages/en/runs.json";

/** AC-59: no label may call a cost billed, actual, invoiced or reconciled. */
const FORBIDDEN = /\b(billed|actual|invoiced|reconciled)\b/i;
/** The legend's only allowed use: the negative sentence of AC-58. */
const NEGATIVE = "No reconciled billing data exists in DevDigest.";

function strings(node: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([path, node]);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, path ? `${path}.${k}` : k, out);
  return out;
}

describe("agent performance copy (AC-58, AC-59)", () => {
  const all = [...strings(agentPerformance, "agentPerformance"), ...strings((runs as { stats: unknown }).stats, "runs.stats")];

  it("scans a non-trivial number of strings", () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it("uses the forbidden words nowhere outside the legend's negative sentence", () => {
    const offenders = all
      .map(([k, v]) => [k, v.replace(NEGATIVE, "")] as const)
      .filter(([, v]) => FORBIDDEN.test(v))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it("keeps the legend text of AC-58 verbatim", () => {
    expect(agentPerformance.cost.legend).toBe(
      "DevDigest estimate: the provider-reported cost when the provider returns one (OpenRouter), otherwise tokens × the DevDigest price book. Unknown models and failed runs have no cost. No reconciled billing data exists in DevDigest.",
    );
  });

  it("no longer carries the texts that contradicted the spec", () => {
    expect(agentPerformance.subtitle).not.toMatch(/headline|cost shown as a breakdown/i);
    expect(agentPerformance.sort.cost).toBe("avg cost");
  });
});
