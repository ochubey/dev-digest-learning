/** POST /findings/:id/learn via app.inject(); ReviewRepository replaced by in-memory spies (no DB). */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { learningText } from '../src/modules/reviews/findings.js';

const WS = '11111111-1111-4111-8111-111111111111';
const OTHER_WS = '22222222-2222-4222-8222-222222222222';
const REPO = '33333333-3333-4333-8333-333333333333';
const PR = '88888888-8888-4888-8888-888888888888';
const REVIEW = '66666666-6666-4666-8666-666666666666';
const FINDING = '77777777-7777-4777-8777-777777777777';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const fakeAuth = { currentUser: async () => ({ id: 'u1' }), currentWorkspace: async () => ({ id: WS }) };
const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

type Mem = { id: string; workspaceId: string; repoId: string; content: string; confidence: number; sources: unknown };
let memory: Mem[];
let pullWs: string;
let closeApp: (() => Promise<void>) | null = null;

const finding = {
  id: FINDING, reviewId: REVIEW, file: 'src/a.ts', startLine: 1, endLine: 2, severity: 'WARNING', category: 'bug',
  title: 'Unchecked null', rationale: 'The value may be null here', suggestion: 'Guard with an early return',
  confidence: 0.8, kind: 'finding', trifectaComponents: null, acceptedAt: null, dismissedAt: null, scope: null, scopeReason: null,
};

beforeEach(() => {
  memory = [];
  pullWs = WS;
  vi.spyOn(ReviewRepository.prototype, 'findingContext').mockImplementation((async (id: string) =>
    id === FINDING ? { finding, review: { id: REVIEW }, pull: { id: PR, repoId: REPO, workspaceId: pullWs } } : undefined) as never);
  vi.spyOn(ReviewRepository.prototype, 'findLearnedMemoryId').mockImplementation((async (ws: string, fid: string) =>
    memory.find((m) => m.workspaceId === ws && (m.sources as { finding_id: string }[])[0]?.finding_id === fid)?.id) as never);
  vi.spyOn(ReviewRepository.prototype, 'insertLearnedMemory').mockImplementation((async (v: Omit<Mem, 'id'>) => {
    memory.push({ id: `m${memory.length + 1}`, ...v });
    return `m${memory.length}`;
  }) as never);
});
afterEach(async () => {
  await closeApp?.();
  closeApp = null;
  vi.restoreAllMocks();
});

async function setup() {
  const app = await buildApp({ config, db: {} as Db, overrides: { auth: fakeAuth as never } });
  closeApp = () => app.close();
  return app;
}

describe('POST /findings/:id/learn', () => {
  it('stores one repo learning and returns the finding shape of accept/dismiss', async () => {
    const app = await setup();
    const res = await app.inject({ method: 'POST', url: `/findings/${FINDING}/learn` });
    expect(res.statusCode).toBe(200);
    expect(res.json().finding).toMatchObject({ id: FINDING, title: 'Unchecked null', accepted_at: null, dismissed_at: null });
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({
      workspaceId: WS,
      repoId: REPO,
      confidence: 0.8,
      sources: [{ finding_id: FINDING, review_id: REVIEW, pr_id: PR }],
      content: 'Unchecked null. The value may be null here. Fix: Guard with an early return.',
    });
  });

  it('is idempotent: a second learn creates no second memory row', async () => {
    const app = await setup();
    await app.inject({ method: 'POST', url: `/findings/${FINDING}/learn` });
    const again = await app.inject({ method: 'POST', url: `/findings/${FINDING}/learn` });
    expect(again.statusCode).toBe(200);
    expect(memory).toHaveLength(1);
  });

  it('foreign workspace and unknown finding -> 404, nothing stored', async () => {
    const app = await setup();
    pullWs = OTHER_WS;
    expect((await app.inject({ method: 'POST', url: `/findings/${FINDING}/learn` })).statusCode).toBe(404);
    pullWs = WS;
    expect((await app.inject({ method: 'POST', url: `/findings/${UNKNOWN}/learn` })).statusCode).toBe(404);
    expect(memory).toHaveLength(0);
  });
});

describe('learningText', () => {
  it('omits the fix when there is no suggestion and caps the length', () => {
    expect(learningText({ title: 'T.', rationale: 'R', suggestion: null })).toBe('T. R.');
    expect(learningText({ title: 'T', rationale: 'x'.repeat(2000), suggestion: null }).length).toBe(600);
  });
});
