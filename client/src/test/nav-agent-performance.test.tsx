import { describe, it, expect } from "vitest";
import { NAV, SHORTCUTS } from "@devdigest/ui";
import { activeKeyFor } from "@/components/app-shell/helpers";
import shell from "../../messages/en/shell.json";

describe("nav: Agent Performance (AC-30, AC-77)", () => {
  const lab = NAV.find((g) => g.section === "SKILLS LAB")!;
  const all = NAV.flatMap((g) => g.items);

  it("adds exactly one item, in SKILLS LAB right after Eval Dashboard, with an existing icon and no shortcut", () => {
    const keys = lab.items.map((i) => i.key);
    expect(keys.indexOf("agent-performance")).toBe(keys.indexOf("eval") + 1);
    expect(all.filter((i) => i.key === "agent-performance")).toHaveLength(1);
    const item = lab.items.find((i) => i.key === "agent-performance")!;
    expect(item).toEqual({ key: "agent-performance", label: "Agent Performance", icon: "BarChart", href: "/agent-performance" });
    expect(item.gKey).toBeUndefined();
  });

  it("registers no new keyboard shortcut for it", () => {
    expect(SHORTCUTS.some((s) => /performance/i.test(s.label))).toBe(false);
  });

  it("is active on /agent-performance and its label comes from nav.agent-performance", () => {
    expect(activeKeyFor("/agent-performance")).toBe("agent-performance");
    expect((shell as { nav: Record<string, string> }).nav["agent-performance"]).toBe("Agent Performance");
  });
});
