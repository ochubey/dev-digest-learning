import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";
import { activeKeyFor } from "@/components/app-shell/helpers";

describe("nav: CI Runs (AC-70)", () => {
  it("NAV has ci-runs -> /ci-runs; activeKeyFor(\"/ci-runs\") === \"ci-runs\"", () => {
    const item = NAV.flatMap((g) => g.items).find((i) => i.key === "ci-runs");
    expect(item).toMatchObject({ label: "CI Runs", href: "/ci-runs" });
    expect(activeKeyFor("/ci-runs")).toBe("ci-runs");
    expect(activeKeyFor("/ci-runs/anything")).toBe("ci-runs");
  });
});
