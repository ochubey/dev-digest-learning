import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { JobRunner, redactSecrets } from '../src/platform/jobs.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

describe('redactSecrets', () => {
  it('masks credentials embedded in URLs and leaves everything else alone', () => {
    expect(
      redactSecrets("fatal: unable to access 'https://x-access-token:ghp_abc123@github.com/o/r.git/': 403"),
    ).toBe("fatal: unable to access 'https://x-access-token:***@github.com/o/r.git/': 403");
    expect(redactSecrets("Cloning into 'x'... repository not found")).toBe("Cloning into 'x'... repository not found");
  });
});

d('JobRunner: a failing fire-and-forget job must not crash the process (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('records the failure (redacted) without an unhandled rejection when `done` is not awaited', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const jobs = new JobRunner(pg.handle.db, { retries: 0 });
      jobs.register('boom', async () => {
        throw new Error("clone failed: https://x-access-token:ghp_secret@github.com/acme/x.git not found");
      });
      const { id } = await jobs.enqueue(workspaceId, 'boom', {}); // fire and forget
      await jobs.onIdle();
      await new Promise((r) => setTimeout(r, 50)); // let any unhandled rejection surface

      expect(unhandled).toEqual([]);
      const [row] = await pg.handle.db.select().from(t.jobs).where(eq(t.jobs.id, id));
      expect(row!.status).toBe('failed');
      expect(row!.error).toContain('x-access-token:***@');
      expect(row!.error).not.toContain('ghp_secret');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('callers that await `done` still get the rejection', async () => {
    const jobs = new JobRunner(pg.handle.db, { retries: 0 });
    jobs.register('boom2', async () => {
      throw new Error('nope');
    });
    const { done } = await jobs.enqueue(workspaceId, 'boom2', {});
    await expect(done).rejects.toThrow('nope');
  });
});
