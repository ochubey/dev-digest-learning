import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, act } from "@testing-library/react";
import { renderWithIntl, messages } from "../test-utils";
import { EstimateLabel } from "./EstimateLabel";

afterEach(cleanup);
const LEGEND = messages.agentPerformance.cost.legend;

describe("EstimateLabel", () => {
  it("shows the word Estimate as a keyboard-focusable control", () => {
    renderWithIntl(<EstimateLabel />);
    const btn = screen.getByRole("button", { name: "Estimate" });
    act(() => btn.focus());
    expect(btn).toHaveFocus();
  });

  it("reveals the legend on keyboard focus and hides it on blur or Escape (AC-58)", () => {
    renderWithIntl(<EstimateLabel />);
    const btn = screen.getByRole("button", { name: "Estimate" });
    expect(screen.queryByText(LEGEND)).toBeNull();
    fireEvent.focus(btn);
    const legend = screen.getByText(LEGEND);
    expect(legend).toHaveAttribute("role", "tooltip");
    expect(btn).toHaveAttribute("aria-describedby", legend.id);
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(screen.queryByText(LEGEND)).toBeNull();
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    expect(screen.queryByText(LEGEND)).toBeNull();
  });

  it("the legend states the estimate basis and that no billing data exists", () => {
    expect(LEGEND).toBe(
      "DevDigest estimate: the provider-reported cost when the provider returns one (OpenRouter), otherwise tokens × the DevDigest price book. Unknown models and failed runs have no cost. No reconciled billing data exists in DevDigest.",
    );
  });
});
