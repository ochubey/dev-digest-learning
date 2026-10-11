import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { PROJECT_DOCS_FIXTURE_SHA } from '../src/db/fixtures/project-docs.js';
import { seed, SEED_PROJECT_CONTEXT_RUN_ID, SEED_CONTEXT_PATHS } from '../src/db/seed.js';
import { RunTrace, EvalSuiteRunDetail } from '@devdigest/shared';
import {
  SEED_EVAL_CASES,
  SEED_EVAL_CASES_BY_AGENT,
  SEED_EVAL_PROMPT_V2_SUFFIX,
  SEED_EVAL_RUNS,
  SEED_EVAL_RUN_V1_ID,
  SEED_EVAL_RUN_V2_ID,
} from '../src/db/fixtures/eval-cases.js';
import { SECURITY_REVIEWER_PROMPT } from '../src/db/seed-prompts.js';
import { resetDemoProject } from '../src/db/demo-reset.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Verify every `@@ -a,b +c,d @@` header against the lines that follow it. */
function hunkErrors(patch: string): string[] {
  const errors: string[] = [];
  const lines = patch.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/);
    if (!m) continue;
    let oldN = 0;
    let newN = 0;
    for (let j = i + 1; j < lines.length && !lines[j]!.startsWith('@@'); j++) {
      const c = lines[j]![0];
      if (c === ' ') (oldN++, newN++);
      else if (c === '-') oldN++;
      else if (c === '+') newN++;
    }
    if (oldN !== Number(m[1] ?? 1) || newN !== Number(m[2] ?? 1)) {
      errors.push(`${lines[i]} but body has -${oldN} +${newN}`);
    }
  }
  return errors;
}

d('demo seed (Testcontainers pg)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db, { demoContext: true });
    await seed(pg.handle.db, { demoContext: true }); // idempotent
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const pr = async (number: number) => {
    const [row] = await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.number, number));
    return row!;
  };

  it('seeded PRs start WITHOUT an Intent (the card shows "not yet analysed")', async () => {
    expect(await pg.handle.db.select().from(t.prIntent)).toEqual([]);
  });

  it('every file of PR #482 has a diff, with hunk headers that match their body and the file stats', async () => {
    const files = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, (await pr(482)).id));
    expect(files.map((f) => f.path).sort()).toEqual([
      'src/api/public/webhooks.ts',
      'src/api/users.ts',
      'src/config.ts',
      'src/middleware/ratelimit.ts',
    ]);
    for (const f of files) {
      expect(f.patch, f.path).toBeTruthy();
      expect(hunkErrors(f.patch!), f.path).toEqual([]);
      const body = f.patch!.split('\n');
      expect(body.filter((l) => l.startsWith('+')).length, `${f.path} additions`).toBe(f.additions);
      expect(body.filter((l) => l.startsWith('-')).length, `${f.path} deletions`).toBe(f.deletions);
    }
  });

  it('seeded findings carry no scope (legacy = in scope); nothing is hidden by default', async () => {
    const rows = await pg.handle.db.select().from(t.findings);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((f) => f.scope == null)).toBe(true);
  });

  it('#483 keeps its finding that lies outside every hunk', async () => {
    const p = await pr(483);
    const [file] = await pg.handle.db.select().from(t.prFiles).where(eq(t.prFiles.prId, p.id));
    expect(hunkErrors(file!.patch!)).toEqual([]);
    const [review] = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, p.id));
    const [finding] = await pg.handle.db.select().from(t.findings).where(and(eq(t.findings.reviewId, review!.id)));
    expect(finding!.startLine).toBe(80);
  });

  it('cleans up an older seed: removes a seed-made Intent + scoped sample findings, keeps a real Intent', async () => {
    const p482 = await pr(482);
    const [review] = await pg.handle.db.select().from(t.reviews).where(and(eq(t.reviews.prId, p482.id), eq(t.reviews.model, 'seed')));
    // simulate the previous seed version
    await pg.handle.db.insert(t.prIntent).values({ prId: p482.id, summary: 'old seeded', model: 'seed', confidence: 0.8 });
    await pg.handle.db.insert(t.findings).values({
      reviewId: review!.id, file: 'src/api/public/webhooks.ts', startLine: 3, endLine: 3, severity: 'INFO',
      category: 'style', title: 'Unused import in webhooks handler', rationale: 'x', confidence: 0.6, scope: 'out',
    });
    await pg.handle.db.update(t.findings).set({ scope: 'signal' }).where(eq(t.findings.reviewId, review!.id));
    await seed(pg.handle.db);
    expect(await pg.handle.db.select().from(t.prIntent)).toEqual([]);
    const rows = await pg.handle.db.select().from(t.findings).where(eq(t.findings.reviewId, review!.id));
    expect(rows.some((f) => f.title === 'Unused import in webhooks handler')).toBe(false);
    expect(rows.every((f) => f.scope == null)).toBe(true);

    // an Intent derived by a real model survives the next seed
    await pg.handle.db.insert(t.prIntent).values({ prId: p482.id, summary: 'real', model: 'openai/gpt-4.1-mini', confidence: 0.9 });
    await seed(pg.handle.db);
    expect((await pg.handle.db.select().from(t.prIntent)).map((r) => r.summary)).toEqual(['real']);
  });

  it('seeds agent context paths and a project-context trace that parses as RunTrace', async () => {
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    expect(agent!.contextPaths).toEqual(SEED_CONTEXT_PATHS);
    expect(SEED_CONTEXT_PATHS).toEqual(['specs/security-baseline.md', 'docs/architecture.md']);

    const [run] = await pg.handle.db.select().from(t.agentRuns).where(eq(t.agentRuns.id, SEED_PROJECT_CONTEXT_RUN_ID));
    expect(run!.status).toBe('done');
    expect(run!.prId).toBe((await pr(482)).id);
    expect(run!.agentId).toBe(agent!.id);

    const [row] = await pg.handle.db.select().from(t.runTraces).where(eq(t.runTraces.runId, SEED_PROJECT_CONTEXT_RUN_ID));
    const trace = RunTrace.parse(row!.trace);
    const entries = trace.specs_read.map((e) => (typeof e === 'string' ? { path: e } : e));
    expect(entries.map((e) => e.path)).toEqual(SEED_CONTEXT_PATHS);
    const blocks = trace.prompt_assembly.project_context_blocks!;
    expect(blocks.map((b) => b.path)).toEqual(SEED_CONTEXT_PATHS);
    expect(blocks[0]!.text).toMatch(/^<untrusted source="specs\/security-baseline\.md">\n[\s\S]+\n<\/untrusted>$/);
    expect(blocks[0]!.text).toContain('Secrets (API keys, tokens) must never be committed or logged.');
    expect(trace.project_context!.commit_sha).toBe(PROJECT_DOCS_FIXTURE_SHA);
    expect(trace.project_context!.injected_tokens).toBeGreaterThan(0);
    expect(trace.project_context!.soft_cap_exceeded).toBe(false);
  });

  it('the seed adds no extra findings or reviews for the project-context run', async () => {
    const p = await pr(482);
    const reviews = await pg.handle.db.select().from(t.reviews).where(eq(t.reviews.prId, p.id));
    expect(reviews.filter((r) => r.runId === SEED_PROJECT_CONTEXT_RUN_ID)).toEqual([]);
    expect(reviews).toHaveLength(1);
  });

  // ---- SPEC-03: eval cases, fixture runs, fixture decisions --------------------------------
  const securityAgent = async () =>
    (await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer')))[0]!;
  const casesOf = async (agentId: string) =>
    pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agentId));
  const stripeFinding = async () =>
    (await pg.handle.db.select().from(t.findings).where(eq(t.findings.title, 'Hardcoded Stripe secret key in commit')))[0]!;
  const n1Finding = async () =>
    (await pg.handle.db.select().from(t.findings).where(eq(t.findings.title, 'N+1 query in user list endpoint')))[0]!;

  it('seeds the eval cases on Security Reviewer: derived ones are linked, the rest are "seeded"; a second seed adds none', async () => {
    const agent = await securityAgent();
    const cases = await casesOf(agent.id);
    expect(cases.length).toBe(SEED_EVAL_CASES.length);
    expect(cases.length).toBeGreaterThanOrEqual(8);
    const meta = (c: (typeof cases)[number]) => c.inputMeta as Record<string, string>;
    expect(cases.map((c) => meta(c).seed_key).sort()).toEqual(SEED_EVAL_CASES.map((c) => c.seed_key).sort());
    const stripe = cases.find((c) => meta(c).seed_key === 'hardcoded-stripe-key')!;
    const n1 = cases.find((c) => meta(c).seed_key === 'n-plus-one-user-list')!;
    expect(meta(stripe)).toMatchObject({ origin: 'accepted_finding', source_finding_id: (await stripeFinding()).id, source_decision: 'accepted' });
    expect(meta(n1)).toMatchObject({ origin: 'dismissed_finding', source_finding_id: (await n1Finding()).id, source_decision: 'dismissed' });
    for (const c of cases) if (!['hardcoded-stripe-key', 'n-plus-one-user-list'].includes(meta(c).seed_key!)) expect(meta(c).origin).toBe('seeded');

    await seed(pg.handle.db, { demoContext: true });
    expect((await casesOf(agent.id)).length).toBe(cases.length);
  });

  it('the repository lists the seeded cases (they parse through the evals mappers)', async () => {
    const agent = await securityAgent();
    const views = await new EvalsRepository(pg.handle.db).listCases(agent.workspaceId, agent.id);
    expect(views.length).toBe(SEED_EVAL_CASES.length);
  });

  it('fixture on: Security Reviewer is v2 with snapshots, and the two fixed runs exist and parse', async () => {
    const agent = await securityAgent();
    expect(agent.version).toBe(2);
    expect(agent.systemPrompt).toBe(SECURITY_REVIEWER_PROMPT + SEED_EVAL_PROMPT_V2_SUFFIX);
    const versions = await pg.handle.db.select().from(t.agentVersions).where(eq(t.agentVersions.agentId, agent.id));
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
    expect((versions.find((v) => v.version === 1)!.configJson as { system_prompt: string }).system_prompt).toBe(SECURITY_REVIEWER_PROMPT);
    expect((versions.find((v) => v.version === 2)!.configJson as { system_prompt: string }).system_prompt).toBe(agent.systemPrompt);

    const repo = new EvalsRepository(pg.handle.db);
    const page = await repo.listRuns(agent.workspaceId, agent.id, null, 10);
    if (page === 'bad_cursor') throw new Error('bad cursor');
    expect(page.items.map((r) => [r.id, r.agent_version, r.status]).sort()).toEqual(
      [
        [SEED_EVAL_RUN_V1_ID, 1, 'completed'],
        [SEED_EVAL_RUN_V2_ID, 2, 'completed'],
      ].sort(),
    );
    for (const r of SEED_EVAL_RUNS) {
      const detail = await repo.getRunDetail(agent.workspaceId, r.id);
      expect(EvalSuiteRunDetail.safeParse(detail).success, r.id).toBe(true);
      expect(detail!.metrics).toEqual(r.metrics);
      expect(detail!.counts).toEqual(r.counts);
      expect(detail!.results.length).toBe(SEED_EVAL_CASES.length);
      expect(detail!.results.every((x) => x.case_id !== null)).toBe(true);
      expect(detail!.manifest.system_prompt).toBe(
        r.agent_version === 1 ? SECURITY_REVIEWER_PROMPT : SECURITY_REVIEWER_PROMPT + SEED_EVAL_PROMPT_V2_SUFFIX,
      );
    }
    // seeding again neither duplicates runs nor bumps the agent again
    await seed(pg.handle.db, { demoContext: true });
    expect((await pg.handle.db.select().from(t.evalSuiteRuns)).length).toBe(2);
    expect((await securityAgent()).version).toBe(2);
  });

  it('fixture on: the Stripe finding is accepted (the N+1 one is not decided), and resetDemoProject keeps it', async () => {
    const stripe = await stripeFinding();
    expect(stripe.acceptedAt).not.toBeNull();
    expect(stripe.dismissedAt).toBeNull();
    expect((await n1Finding()).acceptedAt).toBeNull();
    expect((await n1Finding()).dismissedAt).toBeNull();

    // without the flag the reset clears the mark (the pre-SPEC-03 behaviour) ...
    await resetDemoProject(pg.handle.db);
    expect((await stripeFinding()).acceptedAt).toBeNull();
    // ... with it, the fixture decision is re-applied after clearing
    await resetDemoProject(pg.handle.db, { demoContext: true });
    expect((await stripeFinding()).acceptedAt).not.toBeNull();
    expect((await n1Finding()).acceptedAt).toBeNull();
    expect((await n1Finding()).dismissedAt).toBeNull();
    // the reset does not touch eval data
    expect((await pg.handle.db.select().from(t.evalSuiteRuns)).length).toBe(2);
  });

  it('a deleted seeded case is not re-created by the next seed (the runs keep their snapshot)', async () => {
    const agent = await securityAgent();
    const before = await casesOf(agent.id);
    const victim = before.find((c) => (c.inputMeta as { seed_key: string }).seed_key === 'unused-import')!;
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, victim.id));
    await seed(pg.handle.db, { demoContext: true });
    expect((await casesOf(agent.id)).length).toBe(before.length - 1);
    const orphaned = await pg.handle.db.select().from(t.evalRuns).where(eq(t.evalRuns.suiteRunId, SEED_EVAL_RUN_V1_ID));
    expect(orphaned.filter((r) => r.caseId === null).length).toBe(1);
  });

  it('seeding restores a tampered seeded expectation and diff, and does not re-create a deleted seeded case', async () => {
    const agent = await securityAgent();
    const before = await casesOf(agent.id);
    const keyOf = (c: (typeof before)[number]) => (c.inputMeta as { seed_key?: string }).seed_key;
    const tampered = before.find((c) => keyOf(c) === 'sql-string-concat')!;
    const fixture = SEED_EVAL_CASES.find((c) => c.seed_key === 'sql-string-concat')!;
    await pg.handle.db
      .update(t.evalCases)
      .set({ expectedOutput: { ...fixture.expectation, start_line: 61, end_line: 61 }, inputDiff: 'stale' })
      .where(eq(t.evalCases.id, tampered.id));
    const plain = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: agent.workspaceId,
        ownerKind: 'agent',
        ownerId: agent.id,
        name: 'user made case',
        inputDiff: 'keep me',
        inputMeta: { origin: 'seeded' },
        expectedOutput: { kind: 'must_find', file: 'a.ts', start_line: 1, end_line: 1 },
      })
      .returning();
    const deleted = before.find((c) => keyOf(c) === 'ssrf-webhook-url')!;
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, deleted.id));

    await seed(pg.handle.db, { demoContext: true });

    const after = await casesOf(agent.id);
    const healed = after.find((c) => c.id === tampered.id)!;
    expect(healed.expectedOutput).toEqual(fixture.expectation);
    expect(healed.inputDiff).toBe(fixture.input_diff);
    expect(after.some((c) => keyOf(c) === 'ssrf-webhook-url')).toBe(false);
    const untouched = after.find((c) => c.id === plain[0]!.id)!;
    expect(untouched.inputDiff).toBe('keep me');
    expect(after.length).toBe(before.length); // -1 deleted, +1 user case
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, plain[0]!.id));
  });

  it('every built-in agent gets its own seeded cases, and no fixture runs for the new agents', async () => {
    for (const [name, expected] of Object.entries(SEED_EVAL_CASES_BY_AGENT)) {
      if (name === 'Security Reviewer') continue;
      const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, name));
      const cases = await casesOf(agent!.id);
      const keys = cases.map((c) => (c.inputMeta as { seed_key: string }).seed_key).sort();
      expect(keys, name).toEqual(expected.map((c) => c.seed_key).sort());
      expect(cases.every((c) => (c.inputMeta as { origin: string }).origin === 'seeded'), name).toBe(true);
      expect(cases.filter((c) => (c.expectedOutput as { kind: string }).kind === 'must_find').length, name).toBe(2);
      expect(cases.filter((c) => (c.expectedOutput as { kind: string }).kind === 'must_not_flag').length, name).toBe(2);
      const runs = await pg.handle.db.select().from(t.evalSuiteRuns).where(eq(t.evalSuiteRuns.agentId, agent!.id));
      expect(runs, name).toEqual([]);
    }
  });

  it('a deleted seeded case of another agent is not re-created and a second seed adds none', async () => {
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Performance Reviewer'));
    const before = await casesOf(agent!.id);
    const victim = before.find((c) => (c.inputMeta as { seed_key: string }).seed_key === 'perf-sync-read-in-handler')!;
    await pg.handle.db.delete(t.evalCases).where(eq(t.evalCases.id, victim.id));
    await seed(pg.handle.db, { demoContext: true });
    await seed(pg.handle.db, { demoContext: true });
    expect((await casesOf(agent!.id)).length).toBe(before.length - 1);
    const [general] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'General Reviewer'));
    expect((await casesOf(general!.id)).length).toBe(SEED_EVAL_CASES_BY_AGENT['General Reviewer']!.length);
  });
});


d('demo seed without the fixture docs source (Testcontainers pg)', () => {
  let pg: PgFixture;
  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('attaches no demo documents: against a real repo those paths would be skipped as not_found', async () => {
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    expect(agent!.contextPaths).toEqual([]);
  });

  it('adds the eval cases but no runs, no version bump and no decisions', async () => {
    const [agent] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Security Reviewer'));
    expect(agent!.version).toBe(1);
    expect(agent!.systemPrompt).toBe(SECURITY_REVIEWER_PROMPT);
    expect((await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, agent!.id))).length).toBe(SEED_EVAL_CASES.length);
    expect(await pg.handle.db.select().from(t.evalSuiteRuns)).toEqual([]);
    const [perf] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.name, 'Performance Reviewer'));
    expect((await pg.handle.db.select().from(t.evalCases).where(eq(t.evalCases.ownerId, perf!.id))).length).toBe(
      SEED_EVAL_CASES_BY_AGENT['Performance Reviewer']!.length,
    );
    expect(await pg.handle.db.select().from(t.agentVersions)).toEqual([]);
    const findings = await pg.handle.db.select().from(t.findings);
    expect(findings.every((f) => f.acceptedAt === null && f.dismissedAt === null)).toBe(true);
    await resetDemoProject(pg.handle.db);
    expect((await pg.handle.db.select().from(t.findings)).every((f) => f.acceptedAt === null)).toBe(true);
  });
});
