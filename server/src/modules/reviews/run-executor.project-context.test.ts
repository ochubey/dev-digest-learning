import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockProjectDocsSource } from '../../adapters/mocks.js';

const detailed = vi.fn();
const reviewPullRequest = vi.fn();
vi.mock('../intent/service.js', () => ({
  IntentService: class {
    deriveIntentDetailed = detailed;
  },
}));
vi.mock('../settings/feature-models.js', () => ({
  resolveFeatureModel: async () => ({ provider: 'openrouter', model: 'flash' }),
}));
vi.mock('./diff-loader.js', () => ({ loadDiff: async () => ({ files: [{ path: 'a.ts' }] }) }));
vi.mock('@devdigest/reviewer-core', async (orig) => ({
  ...(await orig<typeof import('@devdigest/reviewer-core')>()),
  reviewPullRequest: (...a: unknown[]) => reviewPullRequest(...a),
}));

import { ReviewRunExecutor } from './run-executor.js';

const SENTINEL = 'BODY-SENTINEL-9f3a';
const TIP = 'tip-sha-123';
const tokenizer = { count: (t: string) => t.length };

function outcome(projectContext: { path: string; text: string }[] = []) {
  return {
    review: { verdict: 'comment', summary: 's', score: 90, findings: [] },
    allFindings: [],
    scope: { total: 0, in: 0, out: 0, signal: 0, hidden: 0, collapsed: 0, modelHints: {}, overrides: {}, overridesTotal: 0, guardTripped: false, active: false },
    llmCalls: 1,
    assembly: { system: '', skills: null, memory: null, specs: null, user: 'u' },
    projectContext,
    chunks: [{ label: 'all' }],
    mode: 'single-pass',
    raw: 'raw',
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0.1,
    grounding: '0/0 passed',
  };
}

function setup(opts: {
  files?: Record<string, string | Uint8Array | null | Error>;
  skills?: { id: string; name: string; enabled: boolean; body: string; contextPaths: string[] }[];
  agentPaths?: string[];
  llmError?: Error;
  sourceError?: Error;
}) {
  const events: { kind: string; msg: string }[] = [];
  const source = new MockProjectDocsSource({ heads: { main: TIP }, files: { [TIP]: opts.files ?? {} } });
  const container = {
    runBus: {
      publish: (_id: string, kind: string, msg: string) => events.push({ kind, msg }),
      buffer: () => events.map((e) => ({ t: 0, ...e })),
      complete: vi.fn(),
      isCancelled: () => false,
    },
    github: async () => ({}),
    llm: async () => {
      if (opts.llmError) throw opts.llmError;
      return {};
    },
    tokenizer,
    projectDocs: vi.fn(async () => {
      if (opts.sourceError) throw opts.sourceError;
      return source;
    }),
    repoIntel: {
      getCallerSignatures: async () => [],
      getRepoMap: async () => ({ degraded: true, text: '', tokens: 0, cached: false }),
      getFileRank: async () => [],
    },
  };
  const reviewRepo = {
    getPrFiles: async () => [],
    insertReview: vi.fn(async () => ({ id: 'rev1' })),
    insertFindings: vi.fn(async (_id: string, fs: unknown[]) => fs),
    markReviewed: vi.fn(async (..._a: unknown[]) => undefined),
    completeAgentRun: vi.fn(async (..._a: unknown[]) => undefined),
    saveRunTrace: vi.fn(async (..._a: unknown[]) => undefined),
  };
  const links = (opts.skills ?? []).map((skill, order) => ({ skill, order }));
  const exec = new ReviewRunExecutor(container as never, reviewRepo as never, { linkedSkills: async () => links } as never);
  const agent = {
    id: 'ag', name: 'A', provider: 'openai', model: 'm', systemPrompt: 'sp', ciFailOn: 'critical', version: 1,
    contextPaths: opts.agentPaths ?? [],
  };
  const run = () =>
    exec.executeRuns('ws', { id: 'pr1', number: 1, title: 't', author: 'x', headSha: 'h', repoId: 'r' } as never,
      { owner: 'o', name: 'r', defaultBranch: 'main' } as never, [{ agent: agent as never, runId: 'run1' }]);
  const trace = () => reviewRepo.saveRunTrace.mock.calls[0]![1] as Record<string, any>;
  return { run, events, reviewRepo, source, container, trace };
}

describe('ReviewRunExecutor project context', () => {
  beforeEach(() => {
    detailed.mockReset();
    detailed.mockResolvedValue({ status: 'failed', error: 'x', attempts: 0 });
    reviewPullRequest.mockReset();
  });

  it('no effective docs -> no source calls, specs_read [], no section', async () => {
    reviewPullRequest.mockResolvedValue(outcome());
    const s = setup({ skills: [{ id: 's1', name: 'S1', enabled: true, body: 'b', contextPaths: [] }] });
    await s.run();
    expect(s.container.projectDocs).not.toHaveBeenCalled();
    expect(s.source.calls).toHaveLength(0);
    expect('projectContext' in (reviewPullRequest.mock.calls[0]![0] as object)).toBe(false);
    expect(s.trace().specs_read).toEqual([]);
    expect(s.trace().project_context ?? null).toBeNull();
    expect(s.trace().prompt_assembly.project_context_blocks ?? null).toBeNull();
    expect(s.events.some((e) => e.msg.startsWith('project context'))).toBe(false);
  });

  it('one injected + one inherited + one missing -> entries in order with origin, status done, log lines', async () => {
    reviewPullRequest.mockResolvedValue(
      outcome([
        { path: 'specs/inh.md', text: `<untrusted source="specs/inh.md">${SENTINEL}</untrusted>` },
        { path: 'docs/own.md', text: 'wrapped own' },
      ]),
    );
    const s = setup({
      files: { 'specs/inh.md': `inherited ${SENTINEL}`, 'docs/own.md': 'own', 'docs/gone.md': null },
      skills: [
        { id: 's1', name: 'Sec', enabled: true, body: 'b', contextPaths: ['specs/inh.md'] },
        { id: 's2', name: 'Off', enabled: false, body: 'b', contextPaths: ['specs/off.md'] },
      ],
      agentPaths: ['docs/own.md', 'docs/gone.md'],
    });
    await s.run();

    const input = reviewPullRequest.mock.calls[0]![0] as { projectContext: { path: string; content: string }[] };
    expect(input.projectContext.map((d) => d.path)).toEqual(['specs/inh.md', 'docs/own.md']);
    expect(input.projectContext[0]!.content).toBe(`inherited ${SENTINEL}`);

    expect(s.trace().specs_read).toEqual([
      { path: 'specs/inh.md', tokens: `inherited ${SENTINEL}`.length, status: 'injected', reason: null, origin: 'skill', skill_name: 'Sec' },
      { path: 'docs/own.md', tokens: 3, status: 'injected', reason: null, origin: 'agent', skill_name: null },
      { path: 'docs/gone.md', tokens: null, status: 'skipped', reason: 'not_found', origin: 'agent', skill_name: null },
    ]);
    expect(s.trace().prompt_assembly.project_context_blocks).toEqual([
      { path: 'specs/inh.md', tokens: `<untrusted source="specs/inh.md">${SENTINEL}</untrusted>`.length, text: `<untrusted source="specs/inh.md">${SENTINEL}</untrusted>` },
      { path: 'docs/own.md', tokens: 'wrapped own'.length, text: 'wrapped own' },
    ]);
    expect((s.reviewRepo.completeAgentRun.mock.calls[0]![1] as { status: string }).status).toBe('done');
    const msgs = s.events.map((e) => e.msg);
    expect(msgs).toContain(`project context: 2 docs injected, ${`inherited ${SENTINEL}`.length + 3} tokens; 1 skipped`);
    expect(msgs).toContain('project context: skipped docs/gone.md (not_found)');
  });

  it('commit sha equals stubbed tip; soft cap flag and injected tokens recorded', async () => {
    reviewPullRequest.mockResolvedValue(outcome([{ path: 'docs/a.md', text: 'w' }]));
    const s = setup({ files: { 'docs/a.md': 'a'.repeat(4001) }, agentPaths: ['docs/a.md'] });
    await s.run();
    expect(s.trace().project_context).toEqual({ commit_sha: TIP, injected_tokens: 4001, soft_cap_exceeded: true });
    expect(s.source.calls.filter((c) => c.method === 'resolveBranchHead')).toHaveLength(1);
  });

  it('LLM throws after resolution -> failure trace keeps specs_read + sha', async () => {
    reviewPullRequest.mockRejectedValue(new Error('llm down'));
    const s = setup({ files: { 'docs/a.md': 'aa' }, agentPaths: ['docs/a.md', 'docs/gone.md'] });
    await s.run();
    expect((s.reviewRepo.completeAgentRun.mock.calls[0]![1] as { status: string }).status).toBe('failed');
    expect(s.trace().specs_read).toHaveLength(2);
    expect(s.trace().specs_read[0]).toMatchObject({ path: 'docs/a.md', status: 'injected', tokens: 2 });
    expect(s.trace().project_context).toEqual({ commit_sha: TIP, injected_tokens: 2, soft_cap_exceeded: false });
  });

  it('failure before resolution -> specs_read []', async () => {
    const s = setup({ files: { 'docs/a.md': 'aa' }, agentPaths: ['docs/a.md'], llmError: new Error('no key') });
    await s.run();
    expect(s.trace().specs_read).toEqual([]);
    expect(s.trace().project_context ?? null).toBeNull();
    expect(s.source.calls).toHaveLength(0);
  });

  it('log lines contain no body sentinel', async () => {
    reviewPullRequest.mockResolvedValue(outcome([{ path: 'docs/a.md', text: 'w' }]));
    const s = setup({ files: { 'docs/a.md': SENTINEL, 'docs/b.md': null }, agentPaths: ['docs/a.md', 'docs/b.md'] });
    await s.run();
    expect(s.events.some((e) => e.msg.includes(SENTINEL))).toBe(false);
    expect(JSON.stringify(s.trace().log)).not.toContain(SENTINEL);
  });

  it('all skipped -> no Project context section', async () => {
    reviewPullRequest.mockResolvedValue(outcome());
    const s = setup({ files: { 'docs/a.md': null }, agentPaths: ['docs/a.md', '../secrets.md'] });
    await s.run();
    expect('projectContext' in (reviewPullRequest.mock.calls[0]![0] as object)).toBe(false);
    expect(s.trace().specs_read.map((e: { reason: string }) => e.reason)).toEqual(['not_found', 'invalid_path']);
    expect(s.trace().prompt_assembly.project_context_blocks ?? null).toBeNull();
    expect(s.trace().project_context).toEqual({ commit_sha: TIP, injected_tokens: 0, soft_cap_exceeded: false });
  });

  it('docs source unavailable (no GitHub token) -> run continues, every doc read_error, sha null', async () => {
    reviewPullRequest.mockResolvedValue(outcome());
    const s = setup({ agentPaths: ['docs/a.md'], sourceError: new Error('no token') });
    await s.run();
    expect('projectContext' in (reviewPullRequest.mock.calls[0]![0] as object)).toBe(false);
    expect(s.trace().specs_read.map((e: { reason: string }) => e.reason)).toEqual(['read_error']);
    expect(s.trace().project_context.commit_sha).toBeNull();
  });
});
