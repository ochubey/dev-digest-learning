import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[project-context] Docker not available - skipping integration tests.');
}

/** SPEC-02 P2: `context_paths` storage and version semantics on agents and skills. */
d('project context attachments (DB)', () => {
  let pg: PgFixture;
  let agents: AgentsRepository;
  let skills: SkillsRepository;
  let ws: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    agents = new AgentsRepository(pg.handle.db);
    skills = new SkillsRepository(pg.handle.db);
    const [w] = await pg.handle.db.select().from(t.workspaces);
    ws = w!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function newAgent() {
    return agents.insert({
      workspaceId: ws,
      name: `A-${Math.random()}`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review.',
    });
  }
  async function newSkill() {
    return skills.insert({
      workspaceId: ws,
      name: `S-${Math.random()}`,
      description: 'd',
      type: 'custom',
      body: 'original body',
    });
  }

  it('stores only ordered paths (sentinel absent from agents, skills, agent_versions, skill_versions)', async () => {
    const SENTINEL = 'SENTINEL-DOC-BODY-9f3a';
    const agent = await newAgent();
    const skill = await newSkill();
    const paths = ['specs/b.md', 'docs/a.md', 'insights/c.md'];
    await agents.setContextPaths(ws, agent.id, paths);
    await skills.setContextPaths(ws, skill.id, paths);

    const [a] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agent.id));
    const [s] = await pg.handle.db.select().from(t.skills).where(eq(t.skills.id, skill.id));
    expect(a!.contextPaths).toEqual(paths);
    expect(s!.contextPaths).toEqual(paths);

    const dump = JSON.stringify([
      await pg.handle.db.select().from(t.agents),
      await pg.handle.db.select().from(t.skills),
      await pg.handle.db.select().from(t.agentVersions),
      await pg.handle.db.select().from(t.skillVersions),
    ]);
    expect(dump).not.toContain(SENTINEL);
  });

  it('agent version +1 per list change, unchanged on identical list', async () => {
    const agent = await newAgent();
    expect(agent.version).toBe(1);

    const r1 = await agents.setContextPaths(ws, agent.id, ['specs/a.md']);
    expect(r1!.version).toBe(2);
    const same = await agents.setContextPaths(ws, agent.id, ['specs/a.md']);
    expect(same!.version).toBe(2);
    const r2 = await agents.setContextPaths(ws, agent.id, ['specs/a.md', 'docs/b.md']);
    expect(r2!.version).toBe(3);
    // Reordering is a change.
    const r3 = await agents.setContextPaths(ws, agent.id, ['docs/b.md', 'specs/a.md']);
    expect(r3!.version).toBe(4);

    const versions = await agents.listVersions(agent.id);
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect((versions[0]!.configJson as { context_paths: string[] }).context_paths).toEqual([
      'docs/b.md',
      'specs/a.md',
    ]);
    expect((versions[3]!.configJson as { context_paths?: string[] }).context_paths).toEqual([]);
  });

  it('agent setContextPaths returns undefined for an unknown agent', async () => {
    expect(
      await agents.setContextPaths(ws, '00000000-0000-0000-0000-000000000000', ['specs/a.md']),
    ).toBeUndefined();
  });

  it('skill version +1 per list change, unchanged on identical list', async () => {
    const skill = await newSkill();
    expect(skill.version).toBe(1);

    const r1 = await skills.setContextPaths(ws, skill.id, ['specs/a.md']);
    expect(r1!.version).toBe(2);
    expect(r1!.body).toBe('original body');
    const same = await skills.setContextPaths(ws, skill.id, ['specs/a.md']);
    expect(same!.version).toBe(2);
    const r2 = await skills.setContextPaths(ws, skill.id, []);
    expect(r2!.version).toBe(3);

    const versions = await skills.listVersions(skill.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.every((v) => v.body === 'original body')).toBe(true);
  });
});

/** SPEC-02 P3b: attach/detach through the service against real Postgres. */
d('project context service (DB)', () => {
  let pg: PgFixture;
  let service: ProjectContextService;
  let agents: AgentsRepository;
  let skills: SkillsRepository;
  let source: MockProjectDocsSource;
  let ws: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    agents = new AgentsRepository(pg.handle.db);
    skills = new SkillsRepository(pg.handle.db);
    const [w] = await pg.handle.db.select().from(t.workspaces);
    ws = w!.id;
    source = new MockProjectDocsSource({ heads: { main: 'sha-1' }, files: { 'sha-1': { 'docs/a.md': 'a' } } });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
    service = new ProjectContextService(
      new Container(config, pg.handle.db, { projectDocs: source }),
    );
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const newAgent = () =>
    agents.insert({ workspaceId: ws, name: `A-${Math.random()}`, provider: 'openai', model: 'gpt-4o-mini', systemPrompt: 'x' });

  it('attach appends path last', async () => {
    const agent = await newAgent();
    await service.setAgentContext(ws, agent.id, ['specs/a.md']);
    const cur = await service.getAgentContext(ws, agent.id);
    const out = await service.setAgentContext(ws, agent.id, [...cur.paths, 'docs/b.md']);
    expect(out.paths).toEqual(['specs/a.md', 'docs/b.md']);
    expect(out.version).toBe(3);
    expect(source.calls).toHaveLength(0);
  });

  it('detach removes and keeps order', async () => {
    const agent = await newAgent();
    await service.setAgentContext(ws, agent.id, ['specs/a.md', 'docs/b.md', 'insights/c.md']);
    const out = await service.setAgentContext(ws, agent.id, ['specs/a.md', 'insights/c.md']);
    expect(out.paths).toEqual(['specs/a.md', 'insights/c.md']);
  });

  it('stale path (not on main) is detachable', async () => {
    const agent = await newAgent();
    // 'docs/deleted.md' does not exist on main; attached earlier, still stored
    await service.setAgentContext(ws, agent.id, ['docs/deleted.md', 'docs/a.md']);
    const out = await service.setAgentContext(ws, agent.id, ['docs/a.md']);
    expect(out.paths).toEqual(['docs/a.md']);
    expect(source.calls).toHaveLength(0);
  });

  it('inherited docs come only from enabled linked skills; skill attach bumps version', async () => {
    const agent = await newAgent();
    const on = await skills.insert({ workspaceId: ws, name: `S-${Math.random()}`, description: 'd', type: 'custom', body: 'b' });
    const off = await skills.insert({ workspaceId: ws, name: `S-${Math.random()}`, description: 'd', type: 'custom', body: 'b' });
    await skills.setEnabled(ws, off.id, false);
    await service.setSkillContext(ws, on.id, ['specs/on.md']);
    await service.setSkillContext(ws, off.id, ['specs/off.md']);
    await agents.linkSkill(agent.id, on.id, 0);
    await agents.linkSkill(agent.id, off.id, 1);
    const out = await service.getAgentContext(ws, agent.id);
    expect(out.inherited.map((i) => i.path)).toEqual(['specs/on.md']);
    expect((await service.getSkillContext(ws, on.id)).version).toBe(2);
  });
});
