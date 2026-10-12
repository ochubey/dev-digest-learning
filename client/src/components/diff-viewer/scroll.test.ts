import { describe, it, expect, afterEach, vi } from "vitest";
import { scrollToTarget } from "./scroll";

function mockMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: reduce && q === "(prefers-reduced-motion: reduce)",
    media: q,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => vi.restoreAllMocks());

describe("scrollToTarget", () => {
  it("uses behavior 'auto' under prefers-reduced-motion (AC-75)", () => {
    mockMedia(true);
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    scrollToTarget(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("uses behavior 'smooth' otherwise", () => {
    mockMedia(false);
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    scrollToTarget(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("never calls focus() and leaves document.activeElement unchanged (AC-74)", () => {
    mockMedia(false);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const el = document.createElement("div");
    el.scrollIntoView = vi.fn();
    el.focus = vi.fn();
    scrollToTarget(el);
    expect(el.focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});
