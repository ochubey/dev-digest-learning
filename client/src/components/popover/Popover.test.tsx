import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Popover } from "./Popover";

afterEach(cleanup);

describe("Popover", () => {
  it("hides content until hovered", () => {
    render(
      <Popover trigger={<span>trigger</span>}>
        <span>panel content</span>
      </Popover>,
    );
    expect(screen.queryByText("panel content")).not.toBeInTheDocument();
  });

  it("shows content on hover", () => {
    const { container } = render(
      <Popover trigger={<span>trigger</span>}>
        <span>panel content</span>
      </Popover>,
    );
    fireEvent.mouseEnter(container.firstElementChild!);
    expect(screen.getByText("panel content")).toBeInTheDocument();
  });
});
