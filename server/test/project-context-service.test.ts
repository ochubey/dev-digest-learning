import { describe, it, expect } from 'vitest';
import { Container } from '../src/platform/container.js';
import { loadConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { MockProjectDocsSource } from '../src/adapters/mocks.js';
import { ProjectContextService } from '../src/modules/project-context/service.js';
import { AppError } from '../src/platform/errors.js';
import {
  AGENT_ID,
  OTHER_WS,
  REPO_ID,
  SKILL_ID,
  WS,
  seedStore,
  type FakeProjectContextStore,
} from './helpers/project-context-store.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

/** 1 token per character: makes "tokens equal tokenizer.count(body)" unambiguous. */
const tokenizer = { count: (t: string) => t.length };

const MAIN = {
  'specs/a.md': 'AAAA',
  'docs/sub/b.md': 'BB',
  'insights/c.MD': 'CCCCCC',
  'src/d.md': 'not a context doc',
  'docs/e.txt': 'not markdown',
};

function setup(opts: { files?: Record<string, Record<string, string | Uint8Array | null | Error>>; store?: FakeProjectContextStore } = {}) {
  const source = new MockProjectDocsSource({
    heads: { main: 'sha-main' },
    files: opts.files ?? { 'sha-main': MAIN },
    extraEntries: {
      'sha-main': [{ path: 'docs/link.md', kind: 'symlink', blobSha: 'blob:link' }],
    },
  });
  const container = new Container(config, {} as Db, { projectDocs: source, tokenizer });
  const store = opts.store ?? seedStore();
  const service = new ProjectContextService(container, store);
  const blobReads = () => source.calls.filter((c) => c.method === 'readBlob').length;
  return { source, store, service, blobReads };
}

describe('ProjectContextService.discover', () => {
  it('lists exactly the 3 valid docs', async () => {
    const { service } = setup();
    const out = await service.discover(WS, REPO_ID);
    expect(out.repo_id).toBe(REPO_ID);
    expect(out.branch).toBe('main');
    expect(out.commit_sha).toBe('sha-main');
    expect(out.docs.map((d) => d.path)).toEqual(['docs/sub/b.md', 'insights/c.MD', 'specs/a.md']);
    expect(out.docs[0]).toEqual({
      path: 'docs/sub/b.md',
      name: 'b.md',
      folder: 'docs/sub',
      source: 'docs',
      tokens: 2,
    });
  });

  it('requests ref = default_branch head only; doc only on other ref absent', async () => {
    const store = seedStore();
    store.repos.get(REPO_ID)!.defaultBranch = 'trunk';
    const { service, source } = setup({
      store,
      files: { 'sha-main': { 'docs/main-only.md': 'x' }, 'sha-trunk': { 'docs/trunk.md': 'yy' } },
    });
    source.setHead('trunk', 'sha-trunk');
    const out = await service.discover(WS, REPO_ID);
    expect(out.docs.map((d) => d.path)).toEqual(['docs/trunk.md']);
    const heads = source.calls.filter((c) => c.method === 'resolveBranchHead');
    expect(heads.map((c) => c.args[1])).toEqual(['trunk']);
    expect(source.calls.filter((c) => c.method !== 'resolveBranchHead').every((c) => c.args.includes('sha-trunk'))).toBe(true);
  });

  it('tokens equal tokenizer.count(body); warm discovery reads no blobs again', async () => {
    const { service, blobReads } = setup();
    const out = await service.discover(WS, REPO_ID);
    expect(Object.fromEntries(out.docs.map((d) => [d.path, d.tokens]))).toEqual({
      'specs/a.md': tokenizer.count('AAAA'),
      'docs/sub/b.md': tokenizer.count('BB'),
      'insights/c.MD': tokenizer.count('CCCCCC'),
    });
    expect(blobReads()).toBe(3);
    await service.discover(WS, REPO_ID);
    expect(blobReads()).toBe(3);
  });

  it('refresh reads the new main tip', async () => {
    const { service, source } = setup({
      files: { 'sha-main': { 'docs/a.md': 'old' }, 'sha-2': { 'docs/a.md': 'new body!', 'docs/b.md': 'b' } },
    });
    expect((await service.discover(WS, REPO_ID)).commit_sha).toBe('sha-main');
    source.setHead('main', 'sha-2');
    const out = await service.discover(WS, REPO_ID, { refresh: true });
    expect(out.commit_sha).toBe('sha-2');
    expect(out.docs.map((d) => [d.path, d.tokens])).toEqual([
      ['docs/a.md', 9],
      ['docs/b.md', 1],
    ]);
  });

  it('symlinked entry absent', async () => {
    const { service } = setup();
    const out = await service.discover(WS, REPO_ID);
    expect(out.docs.map((d) => d.path)).not.toContain('docs/link.md');
  });

  it('non-UTF-8 doc is still listed (lossy tokens)', async () => {
    const { service } = setup({ files: { 'sha-main': { 'docs/bin.md': new Uint8Array([0xff, 0xfe, 0x41]) } } });
    const out = await service.discover(WS, REPO_ID);
    expect(out.docs.map((d) => d.path)).toEqual(['docs/bin.md']);
  });

  it('source failure -> discovery_failed', async () => {
    const source = new MockProjectDocsSource({ headError: new Error('secret-token boom') });
    const container = new Container(config, {} as Db, { projectDocs: source, tokenizer });
    const service = new ProjectContextService(container, seedStore());
    await expect(service.discover(WS, REPO_ID)).rejects.toMatchObject({ code: 'discovery_failed' });
  });
});

describe('ProjectContextService.preview', () => {
  it('preview returns content, tokens, used_by', async () => {
    const { service } = setup({
      files: { 'sha-main': { 'docs/own.md': 'hello', 'specs/skill.md': 'sk' } },
    });
    const own = await service.preview(WS, REPO_ID, 'docs/own.md');
    expect(own).toMatchObject({
      kind: 'ok',
      preview: {
        path: 'docs/own.md',
        source: 'docs',
        tokens: 5,
        content: 'hello',
        commit_sha: 'sha-main',
        used_by: 1,
      },
    });
    // specs/skill.md is on an enabled skill linked to the agent
    const viaSkill = await service.preview(WS, REPO_ID, './specs/skill.md');
    expect(viaSkill).toMatchObject({ kind: 'ok', preview: { used_by: 1 } });
  });

  it('preview not on main -> not_on_main', async () => {
    const { service } = setup();
    expect(await service.preview(WS, REPO_ID, 'docs/gone.md')).toEqual({ kind: 'not_on_main' });
  });

  it('preview of non-UTF-8 -> not_text', async () => {
    const { service } = setup({ files: { 'sha-main': { 'docs/bin.md': new Uint8Array([0xff, 0xfe]) } } });
    expect(await service.preview(WS, REPO_ID, 'docs/bin.md')).toEqual({ kind: 'not_text' });
  });

  it('invalid path -> 400 with zero source calls', async () => {
    const { service, source } = setup();
    for (const p of ['../../.env', '/etc/passwd', 'src/index.ts']) {
      await expect(service.preview(WS, REPO_ID, p)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(source.calls).toHaveLength(0);
  });

  it('other-workspace repo -> 403, unknown -> 404, zero source calls', async () => {
    const { service, source } = setup({ store: seedStore({ repoWs: OTHER_WS }) });
    await expect(service.preview(WS, REPO_ID, 'docs/own.md')).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.discover(WS, REPO_ID)).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.discover(WS, '99999999-9999-4999-8999-999999999999')).rejects.toMatchObject({ statusCode: 404 });
    expect(source.calls).toHaveLength(0);
  });
});

describe('ProjectContextService attachments', () => {
  it('agent context lists inherited docs via enabled skills only', async () => {
    const { service } = setup();
    const out = await service.getAgentContext(WS, AGENT_ID);
    expect(out.paths).toEqual(['docs/own.md']);
    expect(out.version).toBe(1);
    expect(out.inherited).toEqual([{ path: 'specs/skill.md', skill_id: SKILL_ID, skill_name: 'Security' }]);
  });

  it('setAgentContext persists the full ordered list, normalized; invalid/duplicate -> 400, unchanged', async () => {
    const { service, store } = setup();
    const out = await service.setAgentContext(WS, AGENT_ID, ['specs/b.md', './docs/a.md']);
    expect(out.paths).toEqual(['specs/b.md', 'docs/a.md']);
    expect(out.version).toBe(2);
    await expect(service.setAgentContext(WS, AGENT_ID, ['docs/a.md', './docs/a.md'])).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.setAgentContext(WS, AGENT_ID, ['src/x.ts'])).rejects.toBeInstanceOf(AppError);
    expect(store.agents.get(AGENT_ID)!.contextPaths).toEqual(['specs/b.md', 'docs/a.md']);
    expect(store.writes).toHaveLength(1);
  });

  it('skill context get/set; other-workspace skill -> 403 before write', async () => {
    const { service, store } = setup();
    expect(await service.getSkillContext(WS, SKILL_ID)).toEqual({ paths: ['specs/skill.md'], version: 1 });
    expect(await service.setSkillContext(WS, SKILL_ID, ['docs/z.md'])).toEqual({ paths: ['docs/z.md'], version: 2 });
    const other = setup({ store: seedStore({ skillWs: OTHER_WS }) });
    await expect(other.service.setSkillContext(WS, SKILL_ID, ['docs/z.md'])).rejects.toMatchObject({ statusCode: 403 });
    expect(other.store.writes).toHaveLength(0);
    expect(store.writes).toHaveLength(1);
  });

  it('defaultRepo returns the latest workspace repo or null', async () => {
    const { service } = setup();
    expect(await service.defaultRepo(WS)).toEqual({ repo_id: REPO_ID });
    expect(await service.defaultRepo(OTHER_WS)).toEqual({ repo_id: null });
  });
});
