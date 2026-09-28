/**
 * Conventions module (Testcontainers pg). Mirrors skills.it.test.ts's shape:
 * startPg + seed + buildApp with mocked adapters (LLM scripted with a fixture
 * candidate list, git mocked so config-file/sample reads are deterministic).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const EXTRACTION_FIXTURE = {
  candidates: [
    {
      category: 'naming',
      rule: 'Repository classes are named `<Domain>Repository`.',
      evidence: { file: 'src/modules/skills/repository.ts', line: 32 },
      confidence: 0.9,
    },
    {
      category: 'error-handling',
      rule: 'Not-found lookups throw `NotFoundError`, never return null past the route layer.',
      evidence: { file: 'src/platform/errors.ts', line: 19 },
      confidence: 0.75,
    },
  ],
};

d('conventions module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'widgets', fullName: 'acme/widgets' })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function app(structuredBySchema: Record<string, unknown> = { ConventionExtraction: EXTRACTION_FIXTURE }) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({
          files: {
            'tsconfig.json': '{"compilerOptions":{"strict":true}}',
            'src/modules/skills/repository.ts': 'export class SkillsRepository {}',
          },
        }),
        llm: {
          openai: new MockLLMProvider('openai', { structuredBySchema }),
        },
      },
    });
  }

  it('extract persists pending candidates (accepted=false, rejected=false)', async () => {
    const a = await app();
    const res = await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    expect(res.statusCode).toBe(201);
    const candidates = res.json();
    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      expect(c.accepted).toBe(false);
      expect(c.rejected).toBe(false);
    }

    const list = (
      await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    expect(list.length).toBe(2);

    await a.close();
  });

  it('PATCH accept/reject/edit transitions correctly', async () => {
    const a = await app();
    const extracted = (
      await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const [toAccept, toReject] = extracted;

    const accepted = (
      await a.inject({
        method: 'PATCH',
        url: `/conventions/${toAccept.id}`,
        payload: { action: 'accept' },
      })
    ).json();
    expect(accepted.accepted).toBe(true);
    expect(accepted.rejected).toBe(false);

    const rejected = (
      await a.inject({
        method: 'PATCH',
        url: `/conventions/${toReject.id}`,
        payload: { action: 'reject' },
      })
    ).json();
    expect(rejected.rejected).toBe(true);
    expect(rejected.accepted).toBe(false);

    const edited = (
      await a.inject({
        method: 'PATCH',
        url: `/conventions/${toAccept.id}`,
        payload: { action: 'edit', rule: 'Edited rule text.' },
      })
    ).json();
    expect(edited.rule).toBe('Edited rule text.');
    expect(edited.accepted).toBe(true); // edit doesn't change status

    await a.close();
  });

  it('rejected candidates survive reload and are excluded from skill creation', async () => {
    const a = await app();
    const extracted = (
      await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();
    const [acceptMe, rejectMe] = extracted;

    await a.inject({
      method: 'PATCH',
      url: `/conventions/${acceptMe.id}`,
      payload: { action: 'accept' },
    });
    await a.inject({
      method: 'PATCH',
      url: `/conventions/${rejectMe.id}`,
      payload: { action: 'reject' },
    });

    const reloaded = (
      await a.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    const rejectedRow = reloaded.find((c: { id: string }) => c.id === rejectMe.id);
    expect(rejectedRow.rejected).toBe(true);

    // Trying to fold a rejected candidate into a skill along with the accepted
    // one should only pick up the accepted one.
    const skill = (
      await a.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/create-skill`,
        payload: {
          description: 'From accepted conventions',
          candidate_ids: [acceptMe.id, rejectMe.id],
        },
      })
    ).json();
    expect(skill.name).toBe('repo-conventions');
    expect(skill.body).toContain(acceptMe.rule);
    expect(skill.body).not.toContain(rejectMe.rule);
    expect(skill.source).toBe('manual');

    await a.close();
  });

  it('create-skill honors a custom name and shows up in GET /skills (unlinked)', async () => {
    const a = await app();
    const extracted = (
      await a.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();

    const skill = (
      await a.inject({
        method: 'POST',
        url: `/repos/${repoId}/conventions/create-skill`,
        payload: {
          name: 'my-custom-conventions',
          description: 'desc',
          candidate_ids: [extracted[0].id],
        },
      })
    ).json();
    expect(skill.name).toBe('my-custom-conventions');

    const allSkills = (await a.inject({ method: 'GET', url: '/skills' })).json();
    expect(allSkills.some((s: { id: string }) => s.id === skill.id)).toBe(true);
    expect(skill.agent_count).toBe(0); // created unlinked

    await a.close();
  });
});
