/**
 * A1 — skills CRUD + import module. Gated on Docker (needs Postgres), matching
 * the other integration tests (`polling.it.test.ts`, `pulls-comments.it.test.ts`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

function b64(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

d('skills module (Testcontainers pg)', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function app() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('create / list / get: source defaults to manual, version starts at 1', async () => {
    const a = await app();
    const created = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'coverage-gap-rubric', description: 'desc', type: 'rubric', body: 'Check coverage.' },
      })
    ).json();
    expect(created.source).toBe('manual');
    expect(created.version).toBe(1);
    expect(created.enabled).toBe(true);

    const list = (await a.inject({ method: 'GET', url: '/skills' })).json();
    expect(list.some((s: { id: string }) => s.id === created.id)).toBe(true);

    const got = (await a.inject({ method: 'GET', url: `/skills/${created.id}` })).json();
    expect(got.body).toBe('Check coverage.');

    await a.close();
  });

  it('update bumps version and snapshots the OLD body into skill_versions', async () => {
    const a = await app();
    const created = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'flaky-test-patterns', description: '', type: 'custom', body: 'v1 body' },
      })
    ).json();

    const updated = (
      await a.inject({
        method: 'PUT',
        url: `/skills/${created.id}`,
        payload: { body: 'v2 body' },
      })
    ).json();
    expect(updated.version).toBe(2);
    expect(updated.body).toBe('v2 body');

    const versions = (
      await a.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    // newest first; version 1 snapshot holds the OLD body
    expect(versions[0].version).toBe(1);
    expect(versions[0].body).toBe('v1 body');

    await a.close();
  });

  it('PATCH /skills/:id/enabled toggles without bumping version', async () => {
    const a = await app();
    const created = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'no-over-mocking', description: '', type: 'convention', body: 'body' },
      })
    ).json();

    const toggled = (
      await a.inject({ method: 'PATCH', url: `/skills/${created.id}/enabled`, payload: { enabled: false } })
    ).json();
    expect(toggled.enabled).toBe(false);
    expect(toggled.version).toBe(1);

    await a.close();
  });

  it('DELETE hard-deletes and cascades agent_skills links', async () => {
    const a = await app();
    const skill = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'to-delete', description: '', type: 'custom', body: 'body' },
      })
    ).json();
    const agent = (
      await a.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'Linked Agent', provider: 'openai', model: 'gpt-4.1', system_prompt: 'p' },
      })
    ).json();
    await a.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_id: skill.id },
    });

    const del = await a.inject({ method: 'DELETE', url: `/skills/${skill.id}` });
    expect(del.statusCode).toBe(200);

    const links = (
      await a.inject({ method: 'GET', url: `/agents/${agent.id}/skills` })
    ).json();
    expect(links).toHaveLength(0);

    const got = await a.inject({ method: 'GET', url: `/skills/${skill.id}` });
    expect(got.statusCode).toBe(404);

    await a.close();
  });

  it('import preview does not write to the DB; import writes with source=imported_file', async () => {
    const a = await app();
    const md = `---\nname: corner-case-checklist\ntype: convention\ndescription: Checklist for edge cases\n---\nCheck boundary values.`;

    const before = (await a.inject({ method: 'GET', url: '/skills' })).json();

    const preview = (
      await a.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'corner-case-checklist.md', content_base64: b64(md) },
      })
    ).json();
    expect(preview.name).toBe('corner-case-checklist');
    expect(preview.body).toBe('Check boundary values.');

    const after = (await a.inject({ method: 'GET', url: '/skills' })).json();
    expect(after.length).toBe(before.length); // preview wrote nothing

    const imported = (
      await a.inject({
        method: 'POST',
        url: '/skills/import',
        payload: preview,
      })
    ).json();
    expect(imported.source).toBe('imported_file');
    expect(imported.body).toBe('Check boundary values.');

    await a.close();
  });

  it('import preview rejects a non-.md file', async () => {
    const a = await app();
    const res = await a.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'bundle.zip', content_base64: b64('anything') },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });

  it('POST /skills/:id/versions/:version/restore restores an old body and bumps version, snapshotting the pre-restore body', async () => {
    const a = await app();
    const created = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'restore-target', description: '', type: 'custom', body: 'v1 body' },
      })
    ).json();

    await a.inject({ method: 'PUT', url: `/skills/${created.id}`, payload: { body: 'v2 body' } });
    await a.inject({ method: 'PUT', url: `/skills/${created.id}`, payload: { body: 'v3 body' } });

    const restored = (
      await a.inject({ method: 'POST', url: `/skills/${created.id}/versions/1/restore` })
    ).json();
    expect(restored.body).toBe('v1 body');
    expect(restored.version).toBe(4);

    const versions = (
      await a.inject({ method: 'GET', url: `/skills/${created.id}/versions` })
    ).json();
    // newest snapshot (v3) holds the pre-restore body
    expect(versions[0].version).toBe(3);
    expect(versions[0].body).toBe('v3 body');

    await a.close();
  });

  it('restore 404s for an unknown version', async () => {
    const a = await app();
    const created = (
      await a.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'restore-404', description: '', type: 'custom', body: 'body' },
      })
    ).json();
    const res = await a.inject({ method: 'POST', url: `/skills/${created.id}/versions/99/restore` });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it('import preview accepts a .zip archive', async () => {
    const a = await app();
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('zip-skill.md', Buffer.from('---\nname: from-zip\n---\nZip body.', 'utf-8'));
    const content = zip.toBuffer().toString('base64');

    const preview = (
      await a.inject({
        method: 'POST',
        url: '/skills/import/preview',
        payload: { filename: 'bundle.zip', content_base64: content },
      })
    ).json();
    expect(preview.name).toBe('from-zip');
    expect(preview.body).toBe('Zip body.');
    await a.close();
  });

  it('import preview rejects a zip with nested directories (path-traversal/structure guard)', async () => {
    const a = await app();
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();
    zip.addFile('nested/zip-skill.md', Buffer.from('Body', 'utf-8'));
    const content = zip.toBuffer().toString('base64');

    const res = await a.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'bundle.zip', content_base64: content },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });

  it('import preview rejects an oversized body', async () => {
    const a = await app();
    const big = 'a'.repeat(200_001);
    const res = await a.inject({
      method: 'POST',
      url: '/skills/import/preview',
      payload: { filename: 'big.md', content_base64: b64(big) },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });
});
