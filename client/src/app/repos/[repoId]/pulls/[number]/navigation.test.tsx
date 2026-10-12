import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const replace = vi.fn();
const push = vi.fn();
let query = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useParams: () => ({ repoId: "r1", number: "7" }),
  useSearchParams: () => new URLSearchParams(query),
}));

import { usePrNavigation, buildPrHref } from "./navigation";

beforeEach(() => {
  replace.mockReset();
  push.mockReset();
  query = "";
});

describe("buildPrHref", () => {
  it("sets and removes params, encoding with encodeURIComponent", () => {
    expect(buildPrHref("r1", "7", "tab=diff&file=x&trace=t", { file: null, tab: "overview" })).toBe(
      "/repos/r1/pulls/7?tab=overview&trace=t",
    );
    expect(buildPrHref("r1", "7", "", { tab: null })).toBe("/repos/r1/pulls/7");
  });
});

describe("usePrNavigation", () => {
  it("openInDiff encodes file and line and uses replace, never push (AC-36, AC-76)", () => {
    const { result } = renderHook(() => usePrNavigation());
    act(() => result.current.openInDiff("src/a b.ts", 12));
    expect(replace).toHaveBeenCalledWith("/repos/r1/pulls/7?tab=diff&file=src%2Fa%20b.ts&line=12");
    expect(push).not.toHaveBeenCalled();
  });

  it("setTab removes file and line (AC-40)", () => {
    query = "tab=diff&file=src%2Fa.ts&line=3";
    const { result } = renderHook(() => usePrNavigation());
    act(() => result.current.setTab("overview"));
    expect(replace).toHaveBeenCalledWith("/repos/r1/pulls/7?tab=overview");
    expect(push).not.toHaveBeenCalled();
  });

  it("parses tab and target from search params", () => {
    query = "tab=diff&file=src%2Fa.ts&line=12";
    const { result } = renderHook(() => usePrNavigation());
    expect(result.current.tab).toBe("diff");
    expect(result.current.target).toEqual({ file: "src/a.ts", line: 12 });
  });

  it("defaults tab to overview and target to null", () => {
    const { result } = renderHook(() => usePrNavigation());
    expect(result.current.tab).toBe("overview");
    expect(result.current.target).toBeNull();
  });

  it("an invalid line gives line null but keeps the file (AC-63)", () => {
    for (const bad of ["abc", "0", "-3", "1.5", ""]) {
      query = `tab=diff&file=src%2Fa.ts&line=${bad}`;
      const { result } = renderHook(() => usePrNavigation());
      expect(result.current.target).toEqual({ file: "src/a.ts", line: null });
    }
  });

  it("an unsafe file gives target null (AC-63)", () => {
    for (const bad of ["a%00b.ts", "%2Fetc%2Fpasswd", "..%2Fsecret", "src%2F..%2Fx.ts", "C%3A%5Cx.ts", "%5Cx", "a%0Ab.ts", "a%1Fb.ts", "a%7Fb.ts", "a%09b.ts"]) {
      query = `tab=diff&file=${bad}&line=2`;
      const { result } = renderHook(() => usePrNavigation());
      expect(result.current.target).toBeNull();
    }
  });

  it("setParam sets and clears a single param via replace", () => {
    query = "tab=findings";
    const { result } = renderHook(() => usePrNavigation());
    act(() => result.current.setParam("trace", "run1"));
    expect(replace).toHaveBeenLastCalledWith("/repos/r1/pulls/7?tab=findings&trace=run1");
    act(() => result.current.setParam("trace", null));
    expect(replace).toHaveBeenLastCalledWith("/repos/r1/pulls/7?tab=findings");
  });
});
