import { vi } from 'vitest';
import type {
  EvalCaseResult,
  EvalCaseView,
  EvalOverview,
  EvalRunManifest,
  EvalRunPage,
  EvalSuiteRun,
  EvalSuiteRunDetail,
} from '@devdigest/shared';
import type { AgentRow, PullRow } from '../../src/db/rows.js';
import type { FinalizedRun } from '../../src/modules/evals/finalize.js';
import {
  EvalsRepository,
  type EvalsStore,
  type FindingContext,
  type LinkedSkill,
  type NewCase,
  type NewSuiteRun,
  type RepoRow,
  type StoredCase,
} from '../../src/modules/evals/repository.js';

export const WS = '11111111-1111-4111-8111-111111111111';
export const OTHER_WS = '22222222-2222-4222-8222-222222222222';
export const AGENT_ID = '44444444-4444-4444-8444-444444444444';
export const AGENT2_ID = '44444444-4444-4444-8444-444444444445';
export const OTHER_AGENT_ID = '44444444-4444-4444-8444-444444444446';
export const FINDING_ID = '77777777-7777-4777-8777-777777777771';
export const FINDING_OUT_ID = '77777777-7777-4777-8777-777777777772';
export const FINDING_UNDECIDED_ID = '77777777-7777-4777-8777-777777777773';
export const OTHER_FINDING_ID = '77777777-7777-4777-8777-777777777774';
export const PR_ID = '88888888-8888-4888-8888-888888888888';
export const UNKNOWN = '99999999-9999-4999-8999-999999999999';

/** A real single-hunk diff: new-side lines 10..13 of src/config.ts. */
export const RAW_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -10,3 +10,4 @@',
  '   port: 3000,',
  '+  stripeKey: "sk_live_xxx",',
  '   redisUrl: x,',
  '   other: 1,',
  '',
].join('\n');

/** A fragment that validates for an expectation on src/config.ts lines 11-11. */
export const FRAGMENT = RAW_DIFF;

export function fragmentWith(marker: string): string {
  return RAW_DIFF.replace('stripeKey: "sk_live_xxx"', `stripeKey: "${marker}"`);
}

export function agentRow(over: Partial<AgentRow> & { id: string; workspaceId?: string }): AgentRow {
  return {
    workspaceId: WS,
    name: 'Security Reviewer',
    description: '',
    provider: 'openrouter',
    model: 'test/model-a',
    systemPrompt: 'You are the original reviewer.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    enabled: true,
    contextPaths: [],
    version: 3,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as AgentRow;
}

export interface FakeRun {
  id: string;
  workspaceId: string;
  agentId: string;
  agentVersion: number;
  manifest: EvalRunManifest;
  status: EvalSuiteRun['status'];
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  final: FinalizedRun | null;
  results: EvalCaseResult[];
}

let seq = 0;
export const nextId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, '0')}`;

/** In-memory EvalsStore. Every mutation is recorded in `writes`. */
export class FakeEvalStore implements EvalsStore {
  agents = new Map<string, AgentRow>();
  skills = new Map<string, LinkedSkill[]>();
  findings = new Map<string, FindingContext & { workspaceId: string }>();
  cases = new Map<string, StoredCase & { workspaceId: string }>();
  runs = new Map<string, FakeRun>();
  writes: string[] = [];
  /** Reads performed, to assert a foreign-workspace request does no other reads. */
  reads: string[] = [];
  /** When set, createSuiteRun throws it (e.g. a unique violation). */
  createError: Error | null = null;

  async getAgent(ws: string, id: string) {
    this.reads.push('getAgent');
    const a = this.agents.get(id);
    return a && a.workspaceId === ws ? a : undefined;
  }
  async listAgents(ws: string) {
    return [...this.agents.values()].filter((a) => a.workspaceId === ws);
  }
  async linkedSkills(agentId: string) {
    return this.skills.get(agentId) ?? [];
  }
  async findFindingWithContext(ws: string, id: string) {
    this.reads.push('findFindingWithContext');
    const f = this.findings.get(id);
    return f && f.workspaceId === ws ? f : undefined;
  }
  async getPrFiles() {
    return [];
  }
  async existingCasesForFinding(ws: string, findingId: string) {
    return [...this.cases.values()]
      .filter((c) => c.workspaceId === ws && c.meta.source_finding_id === findingId)
      .map((c) => ({ agent_id: c.agent_id, case_id: c.id }));
  }
  private view(c: StoredCase): EvalCaseView {
    return {
      id: c.id,
      agent_id: c.agent_id,
      name: c.name,
      expectation: c.expectation,
      input_diff: c.input_diff,
      notes: c.notes,
      origin: c.meta.origin,
      source_finding_id: c.meta.source_finding_id ?? null,
      source_pr_id: c.meta.source_pr_id ?? null,
      last_result: null,
    };
  }
  async listCases(ws: string, agentId: string) {
    return [...this.cases.values()].filter((c) => c.workspaceId === ws && c.agent_id === agentId).map((c) => this.view(c));
  }
  async countCases(ws: string, agentId: string) {
    return (await this.listCases(ws, agentId)).length;
  }
  async loadCases(ws: string, agentId: string): Promise<StoredCase[]> {
    return [...this.cases.values()].filter((c) => c.workspaceId === ws && c.agent_id === agentId);
  }
  async insertCase(v: NewCase) {
    this.writes.push('insertCase');
    const c = {
      id: nextId(),
      workspaceId: v.workspaceId,
      agent_id: v.agentId,
      name: v.name,
      expectation: v.expectation,
      input_diff: v.inputDiff,
      notes: v.notes,
      meta: v.meta,
    };
    this.cases.set(c.id, c);
    return this.view(c);
  }
  async deleteCase(ws: string, id: string) {
    const c = this.cases.get(id);
    if (!c || c.workspaceId !== ws) return false;
    this.writes.push('deleteCase');
    this.cases.delete(id);
    return true;
  }
  async findRunningRun(ws: string, agentId: string) {
    return [...this.runs.values()].find((r) => r.workspaceId === ws && r.agentId === agentId && r.status === 'running')?.id;
  }
  async countRunningRuns(ws: string) {
    return [...this.runs.values()].filter((r) => r.workspaceId === ws && r.status === 'running').length;
  }
  async createSuiteRun(v: NewSuiteRun) {
    this.writes.push('createSuiteRun');
    if (this.createError) throw this.createError;
    const id = nextId();
    const results: EvalCaseResult[] = v.cases.map((c) => ({
      id: nextId(),
      case_id: c.id,
      case_name: c.name,
      expectation: c.expectation,
      origin: c.meta.origin,
      status: 'pending',
      pass: null,
      grounded: [],
      dropped: [],
      duration_ms: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      error: null,
    }));
    this.runs.set(id, {
      id,
      workspaceId: v.workspaceId,
      agentId: v.agentId,
      agentVersion: v.agentVersion,
      manifest: v.manifest,
      status: 'running',
      error: null,
      startedAt: new Date(Date.now() + this.runs.size),
      finishedAt: null,
      final: null,
      results,
    });
    return { runId: id, resultIds: results.map((r) => r.id) };
  }
  async saveCaseResult(r: EvalCaseResult) {
    this.writes.push('saveCaseResult');
    for (const run of this.runs.values()) {
      const i = run.results.findIndex((x) => x.id === r.id);
      if (i >= 0) run.results[i] = r;
    }
  }
  async finishSuiteRun(runId: string, f: FinalizedRun) {
    this.writes.push('finishSuiteRun');
    const run = this.runs.get(runId)!;
    run.status = f.status;
    run.final = f;
    run.finishedAt = new Date();
  }
  async failRun(runId: string, reason: string) {
    this.writes.push('failRun');
    const run = this.runs.get(runId)!;
    run.status = 'failed';
    run.error = reason;
    run.finishedAt = new Date();
    run.results = run.results.map((r) => (r.status === 'pending' ? { ...r, status: 'error', error: reason } : r));
  }
  private summary(r: FakeRun): EvalSuiteRun {
    return {
      id: r.id,
      agent_id: r.agentId,
      agent_name: this.agents.get(r.agentId)?.name ?? null,
      agent_version: r.agentVersion,
      status: r.status,
      error: r.error,
      cases_total: r.results.length,
      cases_done: r.results.filter((x) => x.status !== 'pending').length,
      metrics: r.final?.metrics ?? { recall: null, precision: null, citation_accuracy: null },
      counts: r.final?.counts ?? null,
      duration_ms: r.final?.durationMs ?? null,
      cost_usd: r.final?.costUsd ?? null,
      started_at: r.startedAt.toISOString(),
      finished_at: r.finishedAt?.toISOString() ?? null,
    };
  }
  async listRuns(ws: string, agentId: string, cursor: string | null, limit: number): Promise<EvalRunPage | 'bad_cursor'> {
    const offset = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(offset) || offset < 0) return 'bad_cursor';
    const all = [...this.runs.values()]
      .filter((r) => r.workspaceId === ws && r.agentId === agentId)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    const items = all.slice(offset, offset + limit).map((r) => this.summary(r));
    return { items, next_cursor: offset + limit < all.length ? String(offset + limit) : null };
  }
  async getRunDetail(ws: string, id: string): Promise<EvalSuiteRunDetail | undefined> {
    this.reads.push('getRunDetail');
    const r = this.runs.get(id);
    if (!r || r.workspaceId !== ws) return undefined;
    return { ...this.summary(r), manifest: r.manifest, results: r.results };
  }
  async overview(ws: string): Promise<EvalOverview> {
    const agents = [...this.agents.values()].filter((a) => a.workspaceId === ws);
    const runs = [...this.runs.values()].filter((r) => r.workspaceId === ws).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return {
      agents: agents.map((a) => {
        const fin = runs.filter((r) => r.agentId === a.id && (r.status === 'completed' || r.status === 'completed_with_errors'));
        return {
          agent_id: a.id,
          name: a.name,
          model: a.model,
          version: a.version,
          latest: fin[0] ? this.summary(fin[0]) : null,
          previous: fin[1] ? this.summary(fin[1]) : null,
        };
      }),
      recent: runs.slice(0, 6).map((r) => this.summary(r)),
    };
  }
  async reapInterrupted() {
    return 0;
  }
  async deleteForAgent() {
    this.writes.push('deleteForAgent');
  }

  // ---- fixtures -----------------------------------------------------------

  addCase(over: Partial<StoredCase> & { workspaceId?: string; agent_id?: string; name: string }): StoredCase {
    const c = {
      id: nextId(),
      workspaceId: WS,
      agent_id: AGENT_ID,
      expectation: { kind: 'must_find' as const, file: 'src/config.ts', start_line: 11, end_line: 11 },
      input_diff: FRAGMENT,
      notes: null,
      meta: { origin: 'seeded' as const },
      ...over,
    };
    this.cases.set(c.id, c);
    return c;
  }

  addRun(over: Partial<FakeRun> & { agentId: string; workspaceId?: string }): FakeRun {
    const run: FakeRun = {
      id: nextId(),
      workspaceId: WS,
      agentVersion: 3,
      manifest: {
        provider: 'openrouter',
        model: 'test/model-a',
        system_prompt: 'p',
        output_schema: null,
        strategy: 'single-pass',
        ci_fail_on: 'critical',
        repo_intel: true,
        skills: [],
        skill_versions: [],
      },
      status: 'completed',
      error: null,
      startedAt: new Date(Date.now() - 1000 * (this.runs.size + 1)),
      finishedAt: new Date(),
      final: null,
      results: [],
      ...over,
    };
    this.runs.set(run.id, run);
    return run;
  }
}

export const STORE_METHODS = [
  'getAgent',
  'listAgents',
  'linkedSkills',
  'findFindingWithContext',
  'getPrFiles',
  'existingCasesForFinding',
  'listCases',
  'countCases',
  'loadCases',
  'insertCase',
  'deleteCase',
  'findRunningRun',
  'countRunningRuns',
  'createSuiteRun',
  'saveCaseResult',
  'finishSuiteRun',
  'failRun',
  'listRuns',
  'getRunDetail',
  'overview',
  'reapInterrupted',
  'deleteForAgent',
] as const satisfies ReadonlyArray<keyof EvalsStore>;

/** Routes every EvalsRepository method to `store` (the project-context-routes pattern). */
export function spyOnEvalsRepository(store: FakeEvalStore): void {
  for (const m of STORE_METHODS) {
    vi.spyOn(EvalsRepository.prototype, m).mockImplementation(((...a: unknown[]) =>
      (store[m] as (...x: unknown[]) => unknown)(...a)) as never);
  }
}

export function seedStore(): FakeEvalStore {
  const store = new FakeEvalStore();
  store.agents.set(AGENT_ID, agentRow({ id: AGENT_ID }));
  store.agents.set(AGENT2_ID, agentRow({ id: AGENT2_ID, name: 'Second Agent' }));
  store.agents.set(OTHER_AGENT_ID, agentRow({ id: OTHER_AGENT_ID, workspaceId: OTHER_WS, name: 'Foreign Agent' }));
  const pull = { id: PR_ID, workspaceId: WS, repoId: 'r', number: 7, title: 't', base: 'main', headSha: 'abc' } as unknown as PullRow;
  const repo = { id: 'r', owner: 'acme', name: 'api', workspaceId: WS } as unknown as RepoRow;
  const finding = (id: string, over: Partial<FindingContext['finding']>, ws = WS) =>
    store.findings.set(id, {
      workspaceId: ws,
      agentId: ws === WS ? AGENT_ID : OTHER_AGENT_ID,
      pull,
      repo,
      finding: {
        id,
        file: 'src/config.ts',
        startLine: 11,
        endLine: 11,
        title: 'Hardcoded Stripe secret key',
        acceptedAt: new Date(),
        dismissedAt: null,
        ...over,
      },
    });
  finding(FINDING_ID, {});
  finding(FINDING_OUT_ID, { startLine: 99, endLine: 99 });
  finding(FINDING_UNDECIDED_ID, { acceptedAt: null });
  finding(OTHER_FINDING_ID, {}, OTHER_WS);
  return store;
}
