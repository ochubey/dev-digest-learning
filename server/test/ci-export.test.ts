import { describe, it, expect, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { MockGitHubClient } from '../src/adapters/mocks.js';
import { CiService } from '../src/modules/ci/service.js';
import { buildPrBody, buildPrTitle } from '../src/modules/ci/pr-body.js';
import { buildBundle } from '../src/modules/ci/bundle.js';
import { mapReadError, mapWriteError, WORKFLOW_SCOPE_MESSAGE } from '../src/modules/ci/github-errors.js';
import { AppError } from '../src/platform/errors.js';
import { generateWorkflow } from '../src/modules/ci/workflow.js';
import {
  FakeCiRepo,
  agentRow,
  asRepo,
  installationRow,
  repoRow,
  skillRow,
  OTHER_AGENT_ID,
} from './helpers/ci-store.js';

const WS = '11111111-1111-4111-8111-111111111111';
const AGENT = '44444444-4444-4444-8444-444444444444';
const RUNNER = 'console.log("runner");';
const input = (over: Record<string, unknown> = {}) =>
  ({
    repo: 'acme/widgets',
    target: 'gha',
    action: 'open_pr',
    post_as: 'github_review',
    triggers: ['opened', 'synchronize'],
    base: 'main',
    ...over,
  }) as never;

function setup(
  opts: {
    repo?: FakeCiRepo;
    github?: MockGitHubClient;
    runner?: string | Error;
    getRepoId?: () => Promise<number>;
  } = {},
) {
  const repo = opts.repo ?? new FakeCiRepo();
  const github = opts.github ?? new MockGitHubClient();
  const log = { info: vi.fn(), warn: vi.fn() };
  const getRepoId = vi.fn(opts.getRepoId ?? (async () => 999));
  const service = new CiService({
    repo: asRepo(repo),
    github: async () => github,
    actions: async () => ({ getRepoId, listCompletedRuns: async () => [], downloadResultArtifact: async () => null }),
    runnerPath: '/fake/agent-runner/dist/index.js',
    readFile: async () => {
      if (opts.runner instanceof Error) throw opts.runner;
      return opts.runner ?? RUNNER;
    },
    log,
  });
  return { service, repo, github, log, getRepoId };
}

const codeOf = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x) => x,
  );
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
};

describe('ci export: validation (no write before every check passes)', () => {
  it('AC-7 openai agent -> 400 ci_provider_unsupported (preview and export)', async () => {
    const s = setup();
    s.repo.agent = agentRow({ provider: 'openai' });
    for (const call of [
      () => s.service.preview(WS, AGENT, input()),
      () => s.service.export(WS, AGENT, input()),
    ]) {
      const e = await codeOf(call());
      expect(e.code).toBe('ci_provider_unsupported');
      expect(e.statusCode).toBe(400);
    }
    expect(s.github.committed).toHaveLength(0);
    expect(s.repo.upserts).toHaveLength(0);
  });

  it('unknown agent -> 404; repo not connected -> 404 ci_repo_not_connected', async () => {
    const s = setup();
    s.repo.agent = undefined;
    expect((await codeOf(s.service.preview(WS, AGENT, input()))).statusCode).toBe(404);
    const s2 = setup();
    const e = await codeOf(s2.service.preview(WS, AGENT, input({ repo: 'acme/other' })));
    expect(e.code).toBe('ci_repo_not_connected');
    expect(e.statusCode).toBe(404);
  });

  it('triggers must be a non-empty subset of the allowed events -> 400 ci_triggers_invalid', async () => {
    const s = setup();
    for (const triggers of [[], ['closed'], ['opened', 'push']]) {
      const e = await codeOf(s.service.preview(WS, AGENT, input({ triggers })));
      expect(e.code).toBe('ci_triggers_invalid');
      expect(e.statusCode).toBe(400);
    }
  });

  it('AC-8 (revision 2) many agents per repo: a second agent on a repo is allowed (no ci_repo_taken)', async () => {
    const s = setup();
    s.repo.installation = { ...installationRow({ agentId: OTHER_AGENT_ID, workflowFile: 'devdigest-review-other-bot.yml', slug: 'other-bot' }), agentName: 'Other Bot' };
    await expect(s.service.preview(WS, AGENT, input())).resolves.toBeTruthy();
    await expect(s.service.export(WS, AGENT, input())).resolves.toBeTruthy();
    expect(s.repo.upserts).toHaveLength(1);
  });

  it('AC-17 missing runner -> 400, no upsert', async () => {
    const s = setup({ runner: new Error('ENOENT') });
    for (const call of [
      () => s.service.preview(WS, AGENT, input()),
      () => s.service.export(WS, AGENT, input()),
      () => s.service.export(WS, AGENT, input({ action: 'files' })),
    ]) {
      const e = await codeOf(call());
      expect(e.code).toBe('ci_runner_missing');
      expect(e.statusCode).toBe(400);
      expect(e.message).toBe('Runner bundle not found. Build it with `pnpm build` in agent-runner/');
    }
    expect(s.repo.upserts).toHaveLength(0);
    expect(s.github.committed).toHaveLength(0);
  });

  it('AC-91 changed slug -> 409 ci_slug_changed and zero commitFiles calls', async () => {
    const s = setup();
    s.repo.installation = { ...installationRow({ slug: 'old-name' }), agentName: 'Secret Gate' };
    const commit = vi.spyOn(s.github, 'commitFiles');
    const e = await codeOf(s.service.export(WS, AGENT, input()));
    expect(e.code).toBe('ci_slug_changed');
    expect(e.statusCode).toBe(409);
    expect(commit).toHaveBeenCalledTimes(0);
    expect(s.github.openedPrs).toHaveLength(0);
    expect(s.repo.upserts).toHaveLength(0);
  });

  it('the same agent re-exporting with an unchanged slug is allowed', async () => {
    const s = setup();
    s.repo.installation = { ...installationRow({ slug: 'secret-gate' }), agentName: 'Secret Gate' };
    await expect(s.service.export(WS, AGENT, input())).resolves.toBeTruthy();
  });
});

describe('ci preview', () => {
  it('returns the file list with the runner emptied and sized, and the versions', async () => {
    const s = setup();
    s.repo.skills = [skillRow('Secret Gate', '# body'), skillRow('secret-gate', '# body2', 'x2')];
    const p = await s.service.preview(WS, AGENT, input());
    expect(p.slug).toBe('secret-gate');
    expect(p.workflow_version).toBe(1);
    expect(p.runner_version).toBe('2');
    const runner = p.files.find((f) => f.path === '.devdigest/runner/index.js')!;
    expect(runner.contents).toBe('');
    expect(runner.size_bytes).toBe(RUNNER.length);
    expect(p.files.map((f) => f.path)).toContain('.devdigest/skills/secret-gate-2.md');
    expect(s.github.committed).toHaveLength(0);
    expect(s.repo.upserts).toHaveLength(0);
  });
});

describe('ci export: open_pr', () => {
  it('AC-37 commit branch devdigest/ci, base = repo default branch (not "main" when the repo says "develop"), PR title', async () => {
    const s = setup();
    s.repo.repo = repoRow({ defaultBranch: 'develop' });
    const out = await s.service.export(WS, AGENT, input({ base: 'main' }));
    expect(s.github.committed).toHaveLength(1);
    expect(s.github.committed[0]!.branch).toBe('devdigest/ci');
    expect(s.github.committed[0]!.base).toBe('develop');
    expect(s.github.committed[0]!.message).toBe('chore(devdigest): add DevDigest CI review');
    expect(s.github.openedPrs).toHaveLength(1);
    expect(s.github.openedPrs[0]!.head).toBe('devdigest/ci');
    expect(s.github.openedPrs[0]!.base).toBe('develop');
    expect(s.github.openedPrs[0]!.title).toBe('Add DevDigest CI review (Secret Gate)');
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(out.zip_base64 ?? null).toBeNull();
  });

  it('AC-38 every recorded ref write targets devdigest/ci', async () => {
    const s = setup();
    await s.service.export(WS, AGENT, input());
    for (const c of s.github.committed) expect(c.branch).toBe('devdigest/ci');
    for (const pr of s.github.openedPrs) expect(pr.head).toBe('devdigest/ci');
    expect(s.github.committed.flatMap((c) => c.files.map((f) => f.path))).toContain(
      '.github/workflows/devdigest-review-secret-gate.yml',
    );
  });

  it('AC-39 findOpenPr returns URL -> no openPullRequest, existing URL returned', async () => {
    const s = setup();
    vi.spyOn(s.github, 'findOpenPr').mockResolvedValue({ url: 'https://github.com/acme/widgets/pull/7' });
    const open = vi.spyOn(s.github, 'openPullRequest');
    const out = await s.service.export(WS, AGENT, input());
    expect(open).not.toHaveBeenCalled();
    expect(out.pr_url).toBe('https://github.com/acme/widgets/pull/7');
    expect(s.github.committed).toHaveLength(1);
  });

  it('AC-45 openPullRequest fails once, retry -> exactly one PR', async () => {
    const s = setup();
    const real = s.github.openPullRequest.bind(s.github);
    const open = vi
      .spyOn(s.github, 'openPullRequest')
      .mockRejectedValueOnce(Object.assign(new Error('Validation Failed'), { status: 422 }))
      .mockImplementation(real);
    const first = await codeOf(s.service.export(WS, AGENT, input()));
    expect(first.code).toBe('github_error');
    expect(s.repo.upserts).toHaveLength(0);
    const out = await s.service.export(WS, AGENT, input());
    expect(out.pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(s.github.openedPrs).toHaveLength(1); // the retry reuses the open PR lookup, never a second PR
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('AC-30 edited node-version committed verbatim', async () => {
    const s = setup();
    const edited = generateWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review', slug: 'secret-gate', file: 'devdigest-review-secret-gate.yml' }).replace(
      'node-version: 22',
      'node-version: 20',
    );
    await s.service.export(WS, AGENT, input({ workflow: edited }));
    const wf = s.github.committed[0]!.files.find((f) => f.path === '.github/workflows/devdigest-review-secret-gate.yml')!;
    expect(wf.contents).toBe(edited);
  });

  it('AC-29 unsafe edited workflow -> 400 ci_workflow_unsafe with details.rule, nothing written', async () => {
    const s = setup();
    const edited = generateWorkflow({ triggers: ['opened'], postAs: 'none', slug: 'secret-gate', file: 'devdigest-review-secret-gate.yml' }).replace('pull_request:', 'pull_request_target:');
    const e = await codeOf(s.service.export(WS, AGENT, input({ workflow: edited })));
    expect(e.code).toBe('ci_workflow_unsafe');
    expect(e.statusCode).toBe(400);
    expect(e.details).toEqual({ rule: 'forbidden_trigger' });
    expect(s.github.committed).toHaveLength(0);
    expect(s.repo.upserts).toHaveLength(0);
  });

  it('success upserts one installation with the repo, slug, versions, triggers, files and PR url (AC-48 shape)', async () => {
    const s = setup();
    await s.service.export(WS, AGENT, input());
    expect(s.repo.upserts).toHaveLength(1);
    expect(s.repo.upserts[0]).toMatchObject({
      agentId: AGENT,
      repo: 'acme/widgets',
      targetType: 'gha',
      slug: 'secret-gate',
      workflowVersion: 1,
      agentVersion: 3,
      ciFailOn: 'critical',
      postAs: 'github_review',
      triggers: ['opened', 'synchronize'],
      prUrl: 'https://github.com/mock/mock/pull/1',
      githubRepoId: 999,
    });
    expect(s.repo.upserts[0]!.files).toEqual([
      '.devdigest/agents/secret-gate.yaml',
      '.devdigest/memory.jsonl',
      '.devdigest/runner/index.js',
      '.github/workflows/devdigest-review-secret-gate.yml',
    ]);
  });

  it('a failing getRepoId does not fail the export (best effort)', async () => {
    const s = setup({ getRepoId: async () => { throw new Error('403'); } });
    await s.service.export(WS, AGENT, input());
    expect(s.repo.upserts[0]!.githubRepoId).toBeNull();
});
});

describe('ci export: GitHub error mapping', () => {
  const failing = (err: unknown) => {
    const s = setup();
    vi.spyOn(s.github, 'commitFiles').mockRejectedValue(err);
    return s;
  };

  it('AC-42: "refusing to allow ... without `workflow` scope" -> github_workflow_scope_missing + exact message', async () => {
    const s = failing(
      Object.assign(
        new Error(
          'refusing to allow a Personal Access Token to create or update workflow `.github/workflows/devdigest-review.yml` without `workflow` scope',
        ),
        { status: 404 },
      ),
    );
    const e = await codeOf(s.service.export(WS, AGENT, input()));
    expect(e.code).toBe('github_workflow_scope_missing');
    expect(e.statusCode).toBe(403);
    expect(e.message).toBe(WORKFLOW_SCOPE_MESSAGE);
    expect(e.message).toContain('workflow');
    expect(e.message).toContain('download the zip');
    expect(s.repo.upserts).toHaveLength(0);
  });

  it('AC-44: 403 and 404 -> github_write_denied naming the repo', async () => {
    for (const status of [403, 404]) {
      const s = failing(Object.assign(new Error('Resource not accessible by integration'), { status }));
      const e = await codeOf(s.service.export(WS, AGENT, input()));
      expect(e.code).toBe('github_write_denied');
      expect(e.statusCode).toBe(403);
      expect(e.message).toContain('acme/widgets');
      expect(e.message).toMatch(/Contents/);
      expect(e.message).toMatch(/Pull requests/);
      expect(s.repo.upserts).toHaveLength(0);
    }
  });

  it('other errors -> github_error 502 with only the first line of the GitHub message', async () => {
    const s = failing(Object.assign(new Error('Server Error\nAuthorization: Bearer ghp_SECRET'), { status: 500 }));
    const e = await codeOf(s.service.export(WS, AGENT, input()));
    expect(e.code).toBe('github_error');
    expect(e.statusCode).toBe(502);
    expect(e.message).toBe('Server Error');
    expect(e.message).not.toContain('ghp_SECRET');
  });

  it('mapWriteError / mapReadError messages never contain headers', () => {
    const err = Object.assign(new Error('Bad\nx-oauth-scopes: repo'), { status: 500 });
    expect(mapWriteError(err, 'a/b').message).not.toContain('x-oauth');
    expect(mapReadError(err, 'a/b').message).not.toContain('x-oauth');
  });
});

describe('ci export: AC-49 failure paths never upsert', () => {
  it('commitFiles, findOpenPr and openPullRequest failures leave no installation', async () => {
    for (const method of ['commitFiles', 'findOpenPr', 'openPullRequest'] as const) {
      const s = setup();
      vi.spyOn(s.github, method).mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
      await codeOf(s.service.export(WS, AGENT, input()));
      expect(s.repo.upserts, method).toHaveLength(0);
    }
  });

  it('validation failures leave no installation either', async () => {
    const s = setup();
    await codeOf(s.service.export(WS, AGENT, input({ triggers: [] })));
    expect(s.repo.upserts).toHaveLength(0);
  });
});

describe('ci export: zip', () => {
  it('AC-46 zip entry names + contents equal the bundle files; filename devdigest-ci-<name>.zip', async () => {
    const s = setup();
    s.repo.skills = [skillRow('Secret Gate', '# body')];
    const out = await s.service.export(WS, AGENT, input({ action: 'files' }));
    expect(out.zip_filename).toBe('devdigest-ci-widgets.zip');
    expect(out.pr_url).toBeNull();
    const zip = new AdmZip(Buffer.from(out.zip_base64!, 'base64'));
    const expected = buildBundle({
      agent: agentRow() as never,
      agentSlug: 'secret-gate',
      skills: [{ slug: 'secret-gate', body: '# body' }],
      memory: [],
      runner: RUNNER,
      triggers: ['opened', 'synchronize'],
      postAs: 'github_review',
      workflowFile: 'devdigest-review-secret-gate.yml',
    });
    // adm-zip lists entries in its own order; the set of names is what AC-46 pins.
    expect(zip.getEntries().map((e) => e.entryName).sort()).toEqual(expected.map((f) => f.path).sort());
    for (const f of expected) expect(zip.readAsText(f.path)).toBe(f.contents);
    // the response lists the runner without contents
    expect(out.files.find((f) => f.path === '.devdigest/runner/index.js')!.contents).toBe('');
  });

  it('AC-47 zip with a GitHub mock that throws on every method', async () => {
    const throwing = new Proxy(
      {},
      {
        get: (_t, prop) => () => {
          throw new Error(`GitHub must not be called: ${String(prop)}`);
        },
      },
    ) as unknown as MockGitHubClient;
    const github = vi.fn(async () => throwing as never);
    const repo = new FakeCiRepo();
    const actions = vi.fn(async () => {
      throw new Error('actions must not be called');
    });
    const service = new CiService({
      repo: asRepo(repo),
      github,
      actions: actions as never,
      runnerPath: '/x',
      readFile: async () => RUNNER,
      log: { info: vi.fn(), warn: vi.fn() },
    });
    const out = await service.export(WS, AGENT, input({ action: 'files' }));
    expect(out.zip_base64).toBeTruthy();
    expect(github).not.toHaveBeenCalled();
    expect(actions).not.toHaveBeenCalled();
    expect(repo.upserts).toHaveLength(1);
    expect(repo.upserts[0]).toMatchObject({ prUrl: null, githubRepoId: null });
  });

  it('AC-48: zip install row has pr_url null and github_repo_id null', async () => {
    const s = setup();
    await s.service.export(WS, AGENT, input({ action: 'files' }));
    expect(s.repo.upserts[0]).toMatchObject({ prUrl: null, githubRepoId: null });
  });
});

describe('ci export: PR body and logging', () => {
  it('AC-40: PR body has the file list, checklist, secret instruction, required-check note', () => {
    const files = buildBundle({
      agent: agentRow() as never,
      agentSlug: 'secret-gate',
      skills: [],
      memory: [],
      runner: 'r',
      triggers: ['opened'],
      postAs: 'none',
      workflowFile: 'devdigest-review-secret-gate.yml',
    });
    const body = buildPrBody(files, { agentName: 'Secret Gate', checkName: 'devdigest-review-secret-gate' });
    for (const f of files) expect(body).toContain(f.path);
    expect(body).toMatch(/- \[ \] \*\*Permissions/);
    expect(body).toMatch(/- \[ \] \*\*Triggers/);
    expect(body).toMatch(/- \[ \] \*\*Secret handling/);
    expect(body).toMatch(/- \[ \] \*\*Which code runs/);
    expect(body).toContain('OPENROUTER_API_KEY');
    expect(body).toContain('Settings -> Secrets and variables -> Actions');
    expect(body).toMatch(/required/i);
    expect(body).toContain('branch protection');
    expect(body).toContain('`devdigest-review-secret-gate` check');
    expect(buildPrTitle('Secret Gate')).toBe('Add DevDigest CI review (Secret Gate)');
  });

  it('logs one export line per export, with the error code on failure and no file bodies', async () => {
    const s = setup();
    await s.service.export(WS, AGENT, input());
    expect(s.log.info).toHaveBeenCalledTimes(1);
    expect(s.log.info.mock.calls[0]![0]).toBe(`ci.export agent=${AGENT} repo=acme/widgets mode=open_pr outcome=ok code=null`);
    const f = setup({ runner: new Error('x') });
    await codeOf(f.service.export(WS, AGENT, input()));
    expect(f.log.info).toHaveBeenCalledTimes(1);
    expect(f.log.info.mock.calls[0]![0]).toContain('outcome=error code=ci_runner_missing');
  });
});

describe('ci export: many agents per repository (revision 2)', () => {
  const LEGACY_PATH = '.github/workflows/devdigest-review.yml';
  const other = (over: Record<string, unknown> = {}) => ({
    ...installationRow({
      id: 'inst-other',
      agentId: OTHER_AGENT_ID,
      slug: 'other-bot',
      triggers: ['reopened'],
      postAs: 'pr_comment',
      ...over,
    } as never),
    agentName: 'Other Bot',
  });
  const paths = (s: ReturnType<typeof setup>) => s.github.committed[0]!.files.map((f) => f.path);

  it('two agents exported into the same repo get different workflow and manifest paths and both installations exist', async () => {
    const repo = new FakeCiRepo();
    // The fake keeps no state across upserts: replay the first agent's saved row for the second export.
    const first = setup({ repo });
    await first.service.export(WS, AGENT, input());
    const saved = repo.upserts[0]!;
    expect(saved.workflowFile).toBe('devdigest-review-secret-gate.yml');
    repo.installation = { ...installationRow(saved as never), agentName: 'Secret Gate' };

    repo.agent = agentRow({ id: OTHER_AGENT_ID, name: 'Other Bot' });
    const second = setup({ repo });
    await second.service.export(WS, OTHER_AGENT_ID, input());
    const a = first.github.committed[0]!.files.map((f) => f.path);
    const b = second.github.committed[0]!.files.map((f) => f.path);
    expect(a).toContain('.github/workflows/devdigest-review-secret-gate.yml');
    expect(a).toContain('.devdigest/agents/secret-gate.yaml');
    expect(b).toContain('.github/workflows/devdigest-review-other-bot.yml');
    expect(b).toContain('.devdigest/agents/other-bot.yaml');
    expect(b).not.toContain('.github/workflows/devdigest-review-secret-gate.yml');
    expect(repo.upserts.map((u) => [u.agentId, u.slug, u.workflowFile])).toEqual([
      [AGENT, 'secret-gate', 'devdigest-review-secret-gate.yml'],
      [OTHER_AGENT_ID, 'other-bot', 'devdigest-review-other-bot.yml'],
    ]);
    const wf = second.github.committed[0]!.files.find((f) => f.path.endsWith('other-bot.yml'))!.contents;
    expect(wf).toContain('name: DevDigest Review (other-bot)');
    expect(wf).toContain('devdigest-review-other-bot:');
    expect(wf).toContain('DEVDIGEST_AGENT: other-bot');
    // no legacy installation on the repo: nothing else is touched
    expect(b).not.toContain(LEGACY_PATH);
  });

  it('a new agent next to a LEGACY installation of another agent regenerates the legacy workflow with DEVDIGEST_AGENT', async () => {
    const s = setup();
    s.repo.agent = agentRow({ id: AGENT, name: 'Perf Check' });
    s.repo.installation = other();
    const preview = await s.service.preview(WS, AGENT, input());
    expect(preview.files.map((f) => f.path)).toContain(LEGACY_PATH);
    const out = await s.service.export(WS, AGENT, input());
    expect(out.files.map((f) => f.path)).toContain(LEGACY_PATH);
    expect(paths(s)).toEqual(
      expect.arrayContaining([LEGACY_PATH, '.github/workflows/devdigest-review-perf-check.yml']),
    );
    const legacy = s.github.committed[0]!.files.find((f) => f.path === LEGACY_PATH)!.contents;
    expect(legacy).toContain('DEVDIGEST_AGENT: other-bot');
    expect(legacy).toContain('DEVDIGEST_POST_AS: pr_comment');
    expect(legacy).toContain('types: [reopened]');
    expect(legacy).toContain('  devdigest-review:\n    name: devdigest-review\n'); // legacy job id/name kept
    // the new installation lists only its own files and gets the per-agent file
    expect(s.repo.upserts[0]!.workflowFile).toBe('devdigest-review-perf-check.yml');
    expect(s.repo.upserts[0]!.files).not.toContain(LEGACY_PATH);
    // PR body notes the update
    const body = s.github.openedPrs[0]!.body;
    expect(body).toContain('## Updated files');
    expect(body).toContain(`\`${LEGACY_PATH}\` (updated so it keeps running next to Perf Check`);
    expect(body).toContain('`devdigest-review-perf-check` check');
  });

  it('the regenerated legacy workflow is not user-editable and is in the zip too', async () => {
    const s = setup();
    s.repo.agent = agentRow({ id: AGENT, name: 'Perf Check' });
    s.repo.installation = other();
    const edited = generateWorkflow({ triggers: ['opened'], postAs: 'none', slug: 'perf-check', file: 'devdigest-review-perf-check.yml' }).replace('node-version: 22', 'node-version: 20');
    const out = await s.service.export(WS, AGENT, input({ action: 'files', workflow: edited }));
    const zip = new AdmZip(Buffer.from(out.zip_base64!, 'base64'));
    expect(zip.readAsText('.github/workflows/devdigest-review-perf-check.yml')).toBe(edited);
    expect(zip.readAsText(LEGACY_PATH)).toContain('DEVDIGEST_AGENT: other-bot');
    expect(zip.readAsText(LEGACY_PATH)).not.toContain('node-version: 20');
  });

  it('a non-legacy installation of another agent is not rewritten', async () => {
    const s = setup();
    s.repo.installation = other({ workflowFile: 'devdigest-review-other-bot.yml' });
    await s.service.export(WS, AGENT, input());
    expect(paths(s)).not.toContain(LEGACY_PATH);
  });

  it('re-exporting a LEGACY installation keeps the legacy path and job, now with DEVDIGEST_AGENT', async () => {
    const s = setup();
    s.repo.installation = { ...installationRow({ slug: 'secret-gate', workflowFile: null }), agentName: 'Secret Gate' };
    await s.service.export(WS, AGENT, input());
    expect(paths(s)).toContain(LEGACY_PATH);
    expect(paths(s)).not.toContain('.github/workflows/devdigest-review-secret-gate.yml');
    const wf = s.github.committed[0]!.files.find((f) => f.path === LEGACY_PATH)!.contents;
    expect(wf).toContain('DEVDIGEST_AGENT: secret-gate');
    expect(wf).toContain('  devdigest-review:\n    name: devdigest-review\n');
    expect(s.repo.upserts[0]!.workflowFile).toBeNull();
    expect(s.github.openedPrs[0]!.body).toContain('`devdigest-review` check');
  });

  it('ci_slug_changed stays per agent: another agent with a different slug does not matter', async () => {
    const s = setup();
    s.repo.installations = [other({ slug: 'old-name' }), { ...installationRow({ slug: 'secret-gate' }), agentName: 'Secret Gate' }];
    await expect(s.service.export(WS, AGENT, input())).resolves.toBeTruthy();
    s.repo.installations = [other(), { ...installationRow({ slug: 'old-name' }), agentName: 'Secret Gate' }];
    expect((await codeOf(s.service.export(WS, AGENT, input()))).code).toBe('ci_slug_changed');
  });
});
