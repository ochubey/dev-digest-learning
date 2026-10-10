import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.0198, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: "### skill",
    skills_meta: [
      { skill_id: "s1", name: "Security review", tokens: 820 },
      { skill_id: "s2", name: "Onion architecture", tokens: 1500 },
    ],
    memory: null,
    specs: null,
    user: "Review PR #482",
  },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

let currentTrace: RunTrace = TRACE;
vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: currentTrace, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  currentTrace = TRACE;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("renders Skills loaded badges with per-skill token counts", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Skills loaded")).toBeInTheDocument();
    expect(screen.getByText("Security review")).toBeInTheDocument();
    expect(screen.getByText("+820 tok")).toBeInTheDocument();
    expect(screen.getByText("Onion architecture")).toBeInTheDocument();
    expect(screen.getByText("+1.5k tok")).toBeInTheDocument();
  });

  it("hides Skills loaded badges when skills_meta is null", () => {
    currentTrace = {
      ...TRACE,
      prompt_assembly: { ...TRACE.prompt_assembly, skills: null, skills_meta: null },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.queryByText("Skills loaded")).not.toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });

  describe("project context (SPEC-02)", () => {
    const BLOCK = '<untrusted source="specs/public-api.md">Public API rules SENTINEL</untrusted>';
    const withPc = (over: Partial<RunTrace> = {}): RunTrace => ({
      ...TRACE,
      specs_read: [
        { path: "specs/public-api.md", tokens: 512, status: "injected", reason: null, origin: "agent", skill_name: null },
        { path: "docs/gone.md", tokens: null, status: "skipped", reason: "not_found", origin: "skill", skill_name: "Sec" },
      ],
      project_context: { commit_sha: "abc", injected_tokens: 512, soft_cap_exceeded: false },
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        project_context_blocks: [{ path: "specs/public-api.md", tokens: 530, text: BLOCK }],
      },
      ...over,
    });

    it("Specs read: injected path + tokens, skipped with reason, none", () => {
      currentTrace = withPc();
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.getByText("specs/public-api.md · 512 tok")).toBeInTheDocument();
      const skipped = screen.getByTestId("spec-skipped");
      expect(skipped).toHaveTextContent("docs/gone.md");
      expect(skipped).toHaveTextContent("Skipped: not found on main");
      cleanup();
      currentTrace = TRACE;
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.getByText("none")).toBeInTheDocument();
    });

    it("opening a project context entry shows the stored block text incl. <untrusted source=", () => {
      currentTrace = withPc();
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Prompt assembly"));
      expect(screen.getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
      fireEvent.click(screen.getByText("specs/public-api.md · 530 tok"));
      const pre = screen.getByText((_, el) => el?.tagName === "PRE" && el.textContent === BLOCK);
      expect(pre).toBeInTheDocument();
    });

    it("soft-cap note only above 4000", () => {
      currentTrace = withPc({ project_context: { commit_sha: "abc", injected_tokens: 4001, soft_cap_exceeded: true } });
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.getByTestId("spec-soft-cap")).toHaveTextContent("4,000");
      cleanup();
      currentTrace = withPc();
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.queryByTestId("spec-soft-cap")).not.toBeInTheDocument();
    });

    it("legacy fixtures render without error", () => {
      currentTrace = {
        ...TRACE,
        specs_read: ["specs/old.md"],
        prompt_assembly: { ...TRACE.prompt_assembly, specs: "old specs body" },
      };
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.getByText("specs/old.md")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Prompt assembly"));
      expect(screen.getByText("Project context (dynamic)")).toBeInTheDocument();
      expect(screen.queryByTestId("spec-soft-cap")).not.toBeInTheDocument();
    });
  });
});
