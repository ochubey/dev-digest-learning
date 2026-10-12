import { describe, it, expect } from 'vitest';
import { EvalsService } from '../src/modules/evals/service.js';
import type { Container } from '../src/platform/container.js';
import { RecordingLLM } from './helpers/recording-llm.js';
import { AGENT_ID, WS, fragmentWith, seedStore } from './helpers/fake-eval-store.js';

function setup(llm: RecordingLLM) {
  const store = seedStore();
  const container = { llm: async () => llm } as unknown as Container;
  const service = new EvalsService(container, store);
  const lines: Array<{ level: 'info' | 'warn'; ids: unknown; msg: string }> = [];
  const log = {
    info: (ids: unknown, msg?: string) => void lines.push({ level: 'info', ids, msg: msg ?? '' }),
    warn: (ids: unknown, msg?: string) => void lines.push({ level: 'warn', ids, msg: msg ?? '' }),
  };
  return { store, service, lines, log };
}
const settled = async (store: ReturnType<typeof seedStore>, id: string) => {
  for (let i = 0; i < 400 && store.runs.get(id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 5));
  expect(store.runs.get(id)!.status).not.toBe('running');
};

describe('EvalsService run execution', () => {
  it('logs a start line, an end line and one line per errored case, with no fragment text (AC-48)', async () => {
    const llm = new RecordingLLM({
      throwFor: (c) => (c.messages[1]!.content.includes('SECRET_FRAGMENT_bad') ? new Error('provider 500') : undefined),
    });
    const { store, service, lines, log } = setup(llm);
    store.addCase({ name: 'good', input_diff: fragmentWith('SECRET_FRAGMENT_good') });
    store.addCase({ name: 'bad', input_diff: fragmentWith('SECRET_FRAGMENT_bad') });
    const { run_id } = await service.startRun(WS, AGENT_ID, log);
    await settled(store, run_id);
    await new Promise((r) => setTimeout(r, 10));

    const msgs = lines.map((l) => l.msg);
    expect(msgs.filter((m) => m.startsWith('eval.run start'))).toHaveLength(1);
    expect(msgs.filter((m) => m.startsWith('eval.run end'))).toHaveLength(1);
    expect(msgs.filter((m) => m.startsWith('eval.case error'))).toHaveLength(1);
    const all = JSON.stringify(lines);
    expect(all).not.toContain('SECRET_FRAGMENT');
    expect(all).not.toContain('marker');
    expect(all).not.toContain('@@');
  });

  it('captures skill bodies at start: a skill edit during the run does not reach it (AC-33)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const llm = new RecordingLLM({ gate });
    const { store, service, log } = setup(llm);
    store.skills.set(AGENT_ID, [{ id: 's1', name: 'sk', version: 1, enabled: true, body: 'ORIGINAL_SKILL_BODY' }]);
    for (let i = 1; i <= 5; i++) store.addCase({ name: `c${i}`, input_diff: fragmentWith(`sk_${i}`) });
    const { run_id } = await service.startRun(WS, AGENT_ID, log);
    for (let i = 0; i < 400 && llm.calls.length < 3; i++) await new Promise((r) => setTimeout(r, 5));
    store.skills.set(AGENT_ID, [{ id: 's1', name: 'sk', version: 2, enabled: true, body: 'EDITED_SKILL_BODY' }]);
    release();
    await settled(store, run_id);

    expect(llm.calls).toHaveLength(5);
    for (const u of llm.userMessages()) {
      expect(u).toContain('ORIGINAL_SKILL_BODY');
      expect(u).not.toContain('EDITED_SKILL_BODY');
    }
  });
});
