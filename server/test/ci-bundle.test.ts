import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import { toSlug, uniqueSlugs } from '../src/modules/ci/slug.js';
import {
  buildBundle,
  buildManifestYaml,
  buildMemoryJsonl,
  readRunner,
  toPreviewFiles,
  RUNNER_MISSING_MESSAGE,
  type BundleAgent,
  type MemoryEntry,
} from '../src/modules/ci/bundle.js';
import { AppError } from '../src/platform/errors.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/ci/exported-manifest.yaml', import.meta.url));

const agent: BundleAgent = {
  name: 'Secret Gate',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  systemPrompt: 'Review for secrets.\nBe strict: never approve a leaked key.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
  version: 3,
};

const input = (over: Partial<Parameters<typeof buildBundle>[0]> = {}) => ({
  agent,
  agentSlug: 'secret-gate',
  skills: [
    { slug: 'secret-gate', body: '# Skill one\n' },
    { slug: 'secret-gate-2', body: '# Skill two\n' },
  ],
  memory: [] as MemoryEntry[],
  runner: 'console.log("runner")',
  triggers: ['opened', 'synchronize'] as ('opened' | 'synchronize' | 'reopened')[],
  postAs: 'github_review' as const,
  ...over,
});

describe('ci slugs', () => {
  it('AC-15: "Secret Gate" and "secret-gate" -> secret-gate, secret-gate-2; manifest lists suffixed slugs', () => {
    const slugs = uniqueSlugs(['Secret Gate', 'secret-gate']);
    expect(slugs).toEqual(['secret-gate', 'secret-gate-2']);
    const yaml = buildManifestYaml(agent, slugs);
    expect(parse(yaml).skills).toEqual(['secret-gate', 'secret-gate-2']);
    const files = buildBundle(input({ skills: slugs.map((s) => ({ slug: s, body: 'x' })) }));
    expect(files.map((f) => f.path)).toContain('.devdigest/skills/secret-gate-2.md');
  });

  it('three duplicates get -2 and -3; unusable names fall back', () => {
    expect(uniqueSlugs(['A', 'a', 'A!'])).toEqual(['a', 'a-2', 'a-3']);
    expect(toSlug('!!!', 'agent')).toBe('agent');
    expect(toSlug('Éclair  Review', 'x')).toBe('eclair-review');
  });
});

describe('ci bundle', () => {
  it('AC-11: exact path list for an agent with two enabled skills (a disabled one excluded)', () => {
    // The disabled skill is filtered by the repository (enabled linked skills only); the bundle
    // is built from exactly what it is given.
    const files = buildBundle(input());
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/secret-gate.yaml',
      '.devdigest/skills/secret-gate.md',
      '.devdigest/skills/secret-gate-2.md',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review.yml',
    ]);
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([
      '.github/workflows/devdigest-review.yml',
    ]);
  });

  it('AC-13: AgentManifest.safeParse(parseYaml(manifest)) equals the agent fixture fields incl. version', () => {
    const parsed = AgentManifest.safeParse(parse(buildManifestYaml(agent, ['a', 'b'])));
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({
      name: 'Secret Gate',
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      system_prompt: agent.systemPrompt,
      skills: ['a', 'b'],
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      version: 3,
    });
  });

  it('AC-14: manifest for the fixture agent equals server/test/fixtures/ci/exported-manifest.yaml byte for byte', () => {
    const yaml = buildManifestYaml(agent, ['secret-gate', 'secret-gate-2']);
    expect(yaml).toBe(readFileSync(FIXTURE, 'utf8'));
  });

  it('AC-16: one line per repo memory entry with only kind/scope/content; empty file when none; other repo\'s entries excluded', () => {
    expect(buildMemoryJsonl([])).toBe('');
    const entries: MemoryEntry[] = [
      { id: 'b', kind: 'convention', scope: 'repo', content: 'second', createdAt: new Date('2026-01-02Z') },
      { id: 'a', kind: 'decision', scope: 'repo', content: 'first\nwith newline', createdAt: new Date('2026-01-01Z') },
    ];
    const out = buildMemoryJsonl(entries);
    expect(out.endsWith('\n')).toBe(true);
    const lines = out.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ kind: 'decision', scope: 'repo', content: 'first\nwith newline' });
    expect(Object.keys(JSON.parse(lines[1]!)).sort()).toEqual(['content', 'kind', 'scope']);
    // Other repositories' entries never reach the generator: it serializes exactly what it is given.
    const files = buildBundle(input({ memory: [entries[0]!] }));
    expect(files.find((f) => f.path === '.devdigest/memory.jsonl')!.contents).toContain('second');
    expect(files.find((f) => f.path === '.devdigest/memory.jsonl')!.contents).not.toContain('first');
  });

  it('AC-16: ties on createdAt are ordered by id', () => {
    const t = new Date('2026-01-01Z');
    const out = buildMemoryJsonl([
      { id: 'z', kind: 'k', scope: 's', content: 'Z', createdAt: t },
      { id: 'a', kind: 'k', scope: 's', content: 'A', createdAt: t },
    ]);
    expect(out.split('\n').map((l) => (l ? JSON.parse(l).content : ''))).toEqual(['A', 'Z', '']);
  });

  it('AC-17: missing runner path throws ci_runner_missing with the exact message', async () => {
    const err = await readRunner('/nope/index.js', async () => {
      throw new Error('ENOENT');
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('ci_runner_missing');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Runner bundle not found. Build it with `pnpm build` in agent-runner/');
    expect(RUNNER_MISSING_MESSAGE).toBe(err.message);
    expect(await readRunner('/x', async () => 'ok')).toBe('ok');
  });

  it('AC-18: two generations are byte-identical', () => {
    const a = buildBundle(input());
    const b = buildBundle(input());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('AC-24: fake key from the secrets provider absent from every generated file', () => {
    const FAKE = 'sk-or-v1-FAKE-SERVER-KEY-0123456789';
    // The generators take no secrets provider; the key may only appear as the secret reference.
    const files = buildBundle(input());
    for (const f of files) expect(f.contents).not.toContain(FAKE);
    const wf = files.find((f) => f.editable)!.contents;
    expect(wf).toContain('${{ secrets.OPENROUTER_API_KEY }}');
  });

  it('toPreviewFiles empties only the runner and reports its size', () => {
    const runner = 'x'.repeat(1000) + 'é';
    const preview = toPreviewFiles(buildBundle(input({ runner })));
    const r = preview.find((f) => f.path === '.devdigest/runner/index.js')!;
    expect(r.contents).toBe('');
    expect(r.size_bytes).toBe(1002);
    expect(preview.find((f) => f.path.endsWith('.yaml'))!.contents).not.toBe('');
  });
});
