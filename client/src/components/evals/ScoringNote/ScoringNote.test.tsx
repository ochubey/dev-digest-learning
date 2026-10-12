import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import evalsShared from "../../../../messages/en/evalsShared.json";
import { ScoringNote } from "./ScoringNote";

afterEach(cleanup);

describe("ScoringNote", () => {
  it("note + disclosure text with three formulas and limits", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ evalsShared }}>
        <ScoringNote />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText(
        "Scoring is mechanical: a finding counts when the file matches and line ranges overlap. No model call in the scorer.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("How metrics are computed").closest("details")).not.toBeNull();
    expect(screen.getByText(/^Recall is the number/)).toBeInTheDocument();
    expect(screen.getByText(/^Precision is the number/)).toBeInTheDocument();
    expect(screen.getByText(/grounding pass rate/i)).toBeInTheDocument();
    expect(screen.getByText(/not semantic/)).toBeInTheDocument();
    expect(screen.getByText(/shifted lines/)).toBeInTheDocument();
  });
});
