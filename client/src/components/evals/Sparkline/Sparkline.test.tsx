import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

afterEach(cleanup);

const pointsOf = (container: HTMLElement) =>
  container.querySelector("polyline")!.getAttribute("points")!.split(" ");

describe("Sparkline", () => {
  it("renders nothing for fewer than two numeric values", () => {
    const { container } = render(<Sparkline values={[0.5, null]} />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    expect(render(<Sparkline values={[]} />).container).toBeEmptyDOMElement();
  });

  it("draws one point per numeric value and skips nulls", () => {
    const { container } = render(<Sparkline values={[0.2, null, 0.8, 1]} />);
    expect(pointsOf(container)).toHaveLength(3);
    expect(container.querySelectorAll("circle")).toHaveLength(1);
  });

  it("maps higher values higher up (smaller y)", () => {
    const { container } = render(<Sparkline values={[0, 1]} height={28} />);
    const [first, last] = pointsOf(container).map((p) => Number(p.split(",")[1]));
    expect(last!).toBeLessThan(first!);
  });

  it("is decorative without a label and an img with one", () => {
    const { container } = render(<Sparkline values={[0.1, 0.9]} />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("svg")).not.toHaveAttribute("role");
    cleanup();
    render(<Sparkline values={[0.1, 0.9]} label="Recall trend over 2 runs" />);
    expect(screen.getByRole("img", { name: "Recall trend over 2 runs" })).toBeInTheDocument();
  });

  it("uses the given color", () => {
    const { container } = render(<Sparkline values={[0.1, 0.9]} color="red" />);
    expect(container.querySelector("polyline")).toHaveAttribute("stroke", "red");
  });
});
