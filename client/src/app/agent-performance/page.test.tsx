import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, crumb }: { children: React.ReactNode; crumb?: { label: string }[] }) => (
    <div>
      <nav aria-label="crumb">{crumb?.map((c) => c.label).join(" / ")}</nav>
      {children}
    </div>
  ),
}));
vi.mock("./_components/AgentPerformanceView", () => ({ AgentPerformanceView: () => <div>view</div> }));

import { NextIntlClientProvider } from "next-intl";
import agentPerformance from "../../../messages/en/agentPerformance.json";
import AgentPerformancePage from "./page";

afterEach(cleanup);

describe("/agent-performance page", () => {
  it("is a thin route: the shell with the Skills Lab breadcrumb around the view", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ agentPerformance }}>
          <AgentPerformancePage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("crumb")).toHaveTextContent("Skills Lab / Agent Performance");
    expect(screen.getByText("view")).toBeInTheDocument();
  });
});
