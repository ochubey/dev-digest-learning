import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RunCostBadge } from "./RunCostBadge";
import { formatCost } from "./helpers";

afterEach(cleanup);

describe("formatCost", () => {
  it("formats a number to 4 decimal places with a $ prefix", () => {
    expect(formatCost(0.0231)).toBe("$0.0231");
    expect(formatCost(1)).toBe("$1.0000");
    expect(formatCost(0)).toBe("$0.0000");
  });

  it("returns — for null or undefined", () => {
    expect(formatCost(null)).toBe("—");
    expect(formatCost(undefined)).toBe("—");
  });
});

describe("RunCostBadge", () => {
  it("renders the formatted cost", () => {
    render(<RunCostBadge costUsd={0.0231} />);
    expect(screen.getByText("$0.0231")).toBeInTheDocument();
  });

  it("renders — when cost is null", () => {
    render(<RunCostBadge costUsd={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
