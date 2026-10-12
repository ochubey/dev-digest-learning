import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { MetricBar } from "./MetricBar";

afterEach(cleanup);

describe("MetricBar", () => {
  it("shows the whole percent as text and in the accessible name", () => {
    render(<MetricBar value={0.875} color="var(--accent)" label="Recall" />);
    expect(screen.getByText("88%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Recall: 88%" })).toBeInTheDocument();
  });

  it("fills the track proportionally with the given color", () => {
    render(<MetricBar value={0.5} color="rgb(1, 2, 3)" label="Precision" />);
    const fill = screen.getByRole("img", { name: "Precision: 50%" }).firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("50%");
    expect(fill.style.background).toBe("rgb(1, 2, 3)");
  });

  it("null renders an empty track and an em dash", () => {
    render(<MetricBar value={null} color="green" label="Citation" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    const track = screen.getByRole("img", { name: "Citation: no value" });
    expect((track.firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("clamps out-of-range values", () => {
    render(<MetricBar value={1.4} color="green" label="Recall" />);
    const fill = screen.getByRole("img").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });
});
