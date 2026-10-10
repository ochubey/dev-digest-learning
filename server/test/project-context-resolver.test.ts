import { describe, it, expect } from 'vitest';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import { resolveProjectContext } from '../src/modules/project-context/resolver.js';
import type { EffectiveDoc } from '../src/modules/project-context/effective.js';

const tokenizer = { count: (t: string) => t.length };
const repo = { owner: 'o', name: 'r' };
const doc = (path: string, origin: 'agent' | 'skill' = 'agent', skillName?: string): EffectiveDoc =>
  origin === 'skill' ? { path, origin, skillId: 's', skillName } : { path, origin };

function run(files: Record<string, string | Uint8Array | null | Error>, effective: EffectiveDoc[], src?: MockProjectDocsSource) {
  const source = src ?? new MockProjectDocsSource({ heads: { main: 'sha1' }, files: { sha1: files } });
  return { source, p: resolveProjectContext({ source, repo, branch: 'main', effective, tokenizer }) };
}
const reads = (s: MockProjectDocsSource) => s.calls.filter((c) => c.method === 'readBlob');

describe('resolveProjectContext', () => {
  it('one resolved ref for all reads', async () => {
    const { source, p } = run({ 'specs/a.md': 'AA', 'docs/b.md': 'BBB' }, [doc('specs/a.md'), doc('docs/b.md', 'skill', 'Sk')]);
    const out = await p;
    expect(source.calls.filter((c) => c.method === 'resolveBranchHead')).toHaveLength(1);
    expect(reads(source).every((c) => c.args[2] === 'sha1')).toBe(true);
    expect(out.commitSha).toBe('sha1');
    expect(out.injectedTokens).toBe(5);
    expect(out.injected).toEqual([
      { path: 'specs/a.md', content: 'AA', tokens: 2 },
      { path: 'docs/b.md', content: 'BBB', tokens: 3 },
    ]);
    expect(out.entries).toEqual([
      { path: 'specs/a.md', tokens: 2, status: 'injected', reason: null, origin: 'agent', skill_name: null },
      { path: 'docs/b.md', tokens: 3, status: 'injected', reason: null, origin: 'skill', skill_name: 'Sk' },
    ]);
    expect(out.softCapExceeded).toBe(false);
  });

  it('missing -> not_found', async () => {
    const out = await run({ 'specs/a.md': null }, [doc('specs/a.md')]).p;
    expect(out.entries[0]).toMatchObject({ status: 'skipped', reason: 'not_found', tokens: null });
    expect(out.injected).toEqual([]);
  });

  it('throw -> read_error', async () => {
    const out = await run({ 'specs/a.md': new Error('boom'), 'specs/b.md': 'ok' }, [doc('specs/a.md'), doc('specs/b.md')]).p;
    expect(out.entries[0]).toMatchObject({ status: 'skipped', reason: 'read_error' });
    expect(out.entries[1]).toMatchObject({ status: 'injected' });
  });

  it('binary -> not_text', async () => {
    const out = await run({ 'specs/a.md': new Uint8Array([0xff, 0xfe, 0x00]) }, [doc('specs/a.md')]).p;
    expect(out.entries[0]).toMatchObject({ status: 'skipped', reason: 'not_text', tokens: null });
  });

  it('whitespace -> empty', async () => {
    const out = await run({ 'specs/a.md': ' \n\t ' }, [doc('specs/a.md')]).p;
    expect(out.entries[0]).toMatchObject({ status: 'skipped', reason: 'empty' });
  });

  it('../secrets.md -> invalid_path with no read call', async () => {
    const { source, p } = run({}, [doc('../secrets.md'), doc('src/x.md')]);
    const out = await p;
    expect(out.entries.map((e) => e.reason)).toEqual(['invalid_path', 'invalid_path']);
    expect(reads(source)).toHaveLength(0);
  });

  it('head unresolvable -> all read_error, sha null', async () => {
    const source = new MockProjectDocsSource({ headError: new Error('down') });
    const out = await run({}, [doc('specs/a.md'), doc('../x.md')], source).p;
    expect(out.commitSha).toBeNull();
    expect(out.entries.map((e) => e.reason)).toEqual(['read_error', 'invalid_path']);
    expect(reads(source)).toHaveLength(0);
    expect(out.injected).toEqual([]);
  });

  it('ceiling cut point -> over_budget for the rest', async () => {
    const big = 'x'.repeat(20000);
    const out = await run(
      { 'specs/a.md': big, 'specs/b.md': 'y'.repeat(12000), 'specs/c.md': 'z'.repeat(13000), 'specs/d.md': 'w' },
      [doc('specs/a.md'), doc('specs/b.md'), doc('specs/c.md'), doc('specs/d.md')],
    ).p;
    expect(out.entries.map((e) => e.status)).toEqual(['injected', 'injected', 'skipped', 'skipped']);
    expect(out.entries[2]).toMatchObject({ reason: 'over_budget', tokens: 13000 });
    expect(out.entries[3]).toMatchObject({ reason: 'over_budget' });
    expect(out.injectedTokens).toBe(32000);
  });

  it('5,000 tokens -> all injected, soft_cap_exceeded true', async () => {
    const out = await run({ 'specs/a.md': 'a'.repeat(2500), 'specs/b.md': 'b'.repeat(2500) }, [doc('specs/a.md'), doc('specs/b.md')]).p;
    expect(out.injected).toHaveLength(2);
    expect(out.softCapExceeded).toBe(true);
    const at = await run({ 'specs/a.md': 'a'.repeat(4000) }, [doc('specs/a.md')]).p;
    expect(at.softCapExceeded).toBe(false);
  });
});
