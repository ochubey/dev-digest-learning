import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

let tabParam: string | null = null;
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "ag1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "tab" ? tabParam : null), toString: () => (tabParam ? `tab=${tabParam}` : "") }),
}));
vi.mock("../../../components/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../_components/AgentCard", () => ({ AgentCard: () => null }));
vi.mock("./_components/AgentEditor", () => ({
  AgentEditor: ({ tab }: { tab: string }) => <div data-testid="editor" data-tab={tab} />,
}));
vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [] }),
  useAgent: () => ({ data: { id: "ag1", name: "Sec", provider: "openai", model: "m", enabled: true }, isLoading: false, isError: false }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
}));

import AgentEditorPage from "./page";

afterEach(cleanup);

describe("AgentEditorPage deep links", () => {
  it("?tab=evals opens the Evals tab (AC-15)", () => {
    tabParam = "evals";
    render(<AgentEditorPage />);
    expect(screen.getByTestId("editor")).toHaveAttribute("data-tab", "evals");
  });

  it("unknown tab falls back to config", () => {
    tabParam = "nope";
    render(<AgentEditorPage />);
    expect(screen.getByTestId("editor")).toHaveAttribute("data-tab", "config");
  });
});
