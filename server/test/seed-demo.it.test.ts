import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { PROJECT_DOCS_FIXTURE_SHA } from '../src/db/fixtures/project-docs.js';
import { seed, SEED_PROJECT_CONTEXT_RUN_ID, SEED_CONTEXT_PATHS } from '../src/db/seed.js';
import { RunTrace } from '@devdigest/shared';
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
});
