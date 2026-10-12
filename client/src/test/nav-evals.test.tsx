import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS } from "@devdigest/ui";
import { activeKeyFor } from "@/components/app-shell/helpers";

describe("nav: Eval Dashboard (AC-58)", () => {
  const lab = NAV.find((g) => g.section === "SKILLS LAB")!;

  it('SKILLS LAB has "Eval Dashboard" after Conventions, href /evals, icon Gauge', () => {
    const keys = lab.items.map((i) => i.key);
    expect(keys.indexOf("eval")).toBe(keys.indexOf("conventions") + 1);
    expect(keys[keys.length - 1]).toBe("eval");
    expect(lab.items.find((i) => i.key === "eval")).toMatchObject({
      label: "Eval Dashboard",
      icon: "Gauge",
      href: "/evals",
      gKey: "e",
    });
  });

  it("g e shortcut is registered and the g keys stay unique", () => {
    expect(SHORTCUTS.some((s) => s.keys === "g e" && s.group === "Navigation")).toBe(true);
    const gKeys = NAV.flatMap((g) => g.items).map((i) => i.gKey).filter(Boolean);
    expect(new Set(gKeys).size).toBe(gKeys.length);
  });

  it('activeKeyFor("/evals/x") === "eval"', () => {
    expect(activeKeyFor("/evals")).toBe("eval");
    expect(activeKeyFor("/evals/x")).toBe("eval");
  });
});
