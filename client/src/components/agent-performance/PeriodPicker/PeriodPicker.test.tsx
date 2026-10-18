import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../test-utils";
import { PeriodPicker } from "./PeriodPicker";

afterEach(cleanup);
const NOW = () => new Date("2026-10-18T12:00:00.000Z");

function setup(value: React.ComponentProps<typeof PeriodPicker>["value"] = { range: "30d" }) {
  const onApply = vi.fn();
  renderWithIntl(<PeriodPicker value={value} onApply={onApply} now={NOW} />);
  return onApply;
}
const apply = () => screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;

describe("PeriodPicker", () => {
  it("offers 1 day, 30 days and Custom with 30 days selected by default (AC-31)", () => {
    setup();
    expect(screen.getAllByRole("radio").map((r) => (r.parentElement as HTMLElement).textContent)).toEqual([
      "1 day",
      "30 days",
      "Custom",
    ]);
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
  });

  it("selecting a preset applies it at once with the clock read at that moment (AC-32)", () => {
    const onApply = setup();
    fireEvent.click(screen.getByRole("radio", { name: "1 day" }));
    expect(onApply).toHaveBeenCalledWith(
      { range: "1d" },
      { from: "2026-10-17T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z" },
    );
  });

  it("Custom shows the date inputs, a UTC hint and a disabled Apply with a reason until dates are set (AC-34)", () => {
    const onApply = setup();
    expect(screen.queryByLabelText("Start date")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    expect(screen.getByText("Dates are UTC.")).toBeInTheDocument();
    expect(apply()).toBeDisabled();
    expect(screen.getByText("Choose a start and an end date.")).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("start after end keeps Apply disabled and says why", () => {
    setup({ range: "custom", start: "2026-09-30", end: "2026-09-01" });
    expect(apply()).toBeDisabled();
    expect(screen.getByText("The start date must not be after the end date.")).toBeInTheDocument();
    expect(apply()).toHaveAttribute("aria-describedby");
  });

  it("a range over 366 days keeps Apply disabled and says why", () => {
    setup({ range: "custom", start: "2025-01-01", end: "2026-01-02" });
    expect(apply()).toBeDisabled();
    expect(screen.getByText("The range cannot be longer than 366 days.")).toBeInTheDocument();
  });

  it("applies a valid custom range as 00:00Z of the start to 00:00Z of the day after the end (AC-33)", () => {
    const onApply = setup({ range: "custom" });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-09-30" } });
    expect(apply()).toBeEnabled();
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledWith(
      { range: "custom", start: "2026-09-01", end: "2026-09-30" },
      { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    );
  });

  it("reflects a controlled value change (URL navigation)", () => {
    const onApply = vi.fn();
    const { rerender } = renderWithIntl(<PeriodPicker value={{ range: "30d" }} onApply={onApply} now={NOW} />);
    rerender(<PeriodPicker value={{ range: "custom", start: "2026-09-01", end: "2026-09-30" }} onApply={onApply} now={NOW} />);
    expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked();
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-09-01");
  });
});
