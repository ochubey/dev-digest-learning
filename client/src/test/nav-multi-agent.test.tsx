import { describe, it, expect } from "vitest";
import { NAV, resolveHref } from "@devdigest/ui";
import { activeKeyFor } from "@/components/app-shell/helpers";

describe("nav: Multi-Agent Review (AC-2)", () => {
  it('WORKSPACE has "Multi-Agent Review" after Pull Requests; resolveHref -> /repos/r1/multi-agent; activeKeyFor matches the key', () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE")!;
    const keys = workspace.items.map((i) => i.key);
    expect(keys.indexOf("multi-agent")).toBe(keys.indexOf("pulls") + 1);

    const item = workspace.items.find((i) => i.key === "multi-agent")!;
    expect(item).toMatchObject({
      label: "Multi-Agent Review",
      icon: "Users",
      href: "/repos/:repoId/multi-agent",
    });
    expect(item.gKey).toBeUndefined();

    expect(resolveHref(item.href, "r1")).toBe("/repos/r1/multi-agent");
    expect(activeKeyFor("/repos/r1/multi-agent")).toBe("multi-agent");
    expect(activeKeyFor("/repos/r1/multi-agent/m1")).toBe("multi-agent");
  });
});
