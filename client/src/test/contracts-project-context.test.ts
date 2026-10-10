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
    const out = ContextDiscovery.parse({ repo_id: "r", branch: "main", commit_sha: "c", docs: [doc], total: 1, truncated: false });
    expect(out.docs).toHaveLength(1);
    expect(out.total).toBe(1);
    expect(out.truncated).toBe(false);
    for (const source of ["root", "other"]) {
      expect(ContextDiscovery.parse({ repo_id: "r", branch: "main", commit_sha: "c", docs: [{ ...doc, source }], total: 1, truncated: false }).docs[0]?.source).toBe(source);
    }
    expect(AgentContextAttachments.parse({ paths: [], version: 0, inherited: [] }).version).toBe(0);
    expect(PROJECT_CONTEXT_SOFT_CAP_TOKENS).toBe(4000);
  });
});

describe('client project-context constants mirror the shared contract', () => {
  it('SOURCE_ORDER, SOURCE_FOLDERS, MAX_DISCOVERED and SOFT_CAP_TOKENS equal the shared values', async () => {
    const shared = await import('@devdigest/shared');
    const local = await import('../components/project-context/constants');
    expect([...local.SOURCE_ORDER]).toEqual([...shared.PROJECT_CONTEXT_SOURCES]);
    expect([...local.SOURCE_FOLDERS]).toEqual([...shared.PROJECT_CONTEXT_FOLDERS]);
    expect(local.MAX_DISCOVERED).toBe(shared.PROJECT_CONTEXT_MAX_DISCOVERED);
    expect(Object.keys(local.SERIALIZE_HEADINGS)).toEqual([...shared.PROJECT_CONTEXT_SOURCES]);
    expect(Object.keys(local.SOURCE_COLOR)).toEqual([...shared.PROJECT_CONTEXT_SOURCES]);
    expect(local.SOFT_CAP_TOKENS).toBe(shared.PROJECT_CONTEXT_SOFT_CAP_TOKENS);
  });

  it('MAX_ATTACHED and MAX_PATH_LENGTH equal the shared values and the input schema enforces them', async () => {
    const shared = await import('@devdigest/shared');
    const local = await import('../components/project-context/constants');
    expect(local.MAX_ATTACHED).toBe(shared.PROJECT_CONTEXT_MAX_ATTACHED);
    expect(local.MAX_PATH_LENGTH).toBe(shared.PROJECT_CONTEXT_MAX_PATH_LENGTH);
    const paths = (n: number) => Array.from({ length: n }, (_, i) => `docs/d${i}.md`);
    expect(shared.ContextAttachmentsInput.safeParse({ paths: paths(local.MAX_ATTACHED) }).success).toBe(true);
    expect(shared.ContextAttachmentsInput.safeParse({ paths: paths(local.MAX_ATTACHED + 1) }).success).toBe(false);
    const long = (n: number) => `docs/${'a'.repeat(n - 8)}.md`;
    expect(shared.ContextAttachmentsInput.safeParse({ paths: [long(local.MAX_PATH_LENGTH)] }).success).toBe(true);
    expect(shared.ContextAttachmentsInput.safeParse({ paths: [long(local.MAX_PATH_LENGTH + 1)] }).success).toBe(false);
  });
});
