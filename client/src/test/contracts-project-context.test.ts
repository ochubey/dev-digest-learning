import { describe, it, expect } from "vitest";
import {
  RunTrace,
  ContextDiscovery,
  AgentContextAttachments,
  PROJECT_CONTEXT_SOFT_CAP_TOKENS,
} from "@devdigest/shared";

const baseTrace = {
  config: { agent: "Security Reviewer", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: null, findings: 0, grounding: "0/0" },
  tool_calls: [],
  raw_output: "{}",
  memory_pulled: [],
  log: [],
};

describe("client copy of project-context contracts", () => {
  it("client copy parses legacy and new traces", () => {
    const legacy = RunTrace.parse({
      ...baseTrace,
      prompt_assembly: { system: "s", user: "u", specs: "legacy" },
      specs_read: ["specs/a.md"],
    });
    expect(legacy.specs_read).toEqual(["specs/a.md"]);

    const next = RunTrace.parse({
      ...baseTrace,
      prompt_assembly: {
        system: "s",
        user: "u",
        project_context_blocks: [{ path: "specs/a.md", tokens: 12, text: "t" }],
      },
      specs_read: [
        { path: "specs/a.md", tokens: 12, status: "injected", origin: "agent" },
        { path: "docs/b.md", tokens: null, status: "skipped", reason: "over_budget", origin: "skill", skill_name: "sec" },
      ],
      project_context: { commit_sha: null, injected_tokens: 12, soft_cap_exceeded: false },
    });
    expect(next.specs_read).toHaveLength(2);
    expect(next.project_context?.commit_sha).toBeNull();
  });

  it("parses discovery and attachments", () => {
    const doc = { path: "specs/a.md", name: "a.md", folder: "specs", source: "specs", tokens: 1 };
    expect(ContextDiscovery.parse({ repo_id: "r", branch: "main", commit_sha: "c", docs: [doc] }).docs).toHaveLength(1);
    expect(AgentContextAttachments.parse({ paths: [], version: 0, inherited: [] }).version).toBe(0);
    expect(PROJECT_CONTEXT_SOFT_CAP_TOKENS).toBe(4000);
  });
});

describe('client project-context constants mirror the shared contract', () => {
  it('SOURCE_ORDER and SOFT_CAP_TOKENS equal the shared values', async () => {
    const shared = await import('@devdigest/shared');
    const local = await import('../components/project-context/constants');
    expect([...local.SOURCE_ORDER]).toEqual([...shared.PROJECT_CONTEXT_FOLDERS]);
    expect(local.SOFT_CAP_TOKENS).toBe(shared.PROJECT_CONTEXT_SOFT_CAP_TOKENS);
  });
});
