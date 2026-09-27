import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { FindingsPreviewPopover } from "./FindingsPreviewPopover";

afterEach(cleanup);

describe("FindingsPreviewPopover", () => {
  it("renders — when there's no run yet", () => {
    render(<FindingsPreviewPopover findings={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows severity counts as the trigger, and a read-only preview list on hover", () => {
    const { container } = render(
      <FindingsPreviewPopover
        findings={{
          severity_counts: { CRITICAL: 1, WARNING: 1, SUGGESTION: 0 },
          items: [
            { severity: "CRITICAL", title: "Hardcoded secret", category: "security", file: "src/config.ts", start_line: 12, confidence: 0.98 },
            { severity: "WARNING", title: "N+1 query", category: "perf", file: "src/api/users.ts", start_line: 45, confidence: 0.86 },
          ],
        }}
      />,
    );
    expect(screen.queryByText("2 FINDINGS IN THIS RUN")).not.toBeInTheDocument();
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(screen.getByText("2 FINDINGS IN THIS RUN")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Accept")).not.toBeInTheDocument();
    expect(screen.queryByText("Dismiss")).not.toBeInTheDocument();
  });
});
