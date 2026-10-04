import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { githubAuthConfig, stripUrlCredentials } from './auth.js';
import { SimpleGitClient } from './simple-git.js';

describe('githubAuthConfig', () => {
  it('builds a github.com extraheader (basic auth) and never exposes the token in plain text', () => {
    const [entry] = githubAuthConfig('ghp_TESTTOKEN');
    expect(entry).toMatch(/^http\.https:\/\/github\.com\/\.extraheader=AUTHORIZATION: basic /);
    const b64 = entry!.split('basic ')[1]!;
    expect(Buffer.from(b64, 'base64').toString()).toBe('x-access-token:ghp_TESTTOKEN');
    expect(entry).not.toContain('ghp_TESTTOKEN');
  });
});

describe('stripUrlCredentials', () => {
  it('removes user:password from http(s) URLs and leaves other forms untouched', () => {
    expect(stripUrlCredentials('https://x-access-token:ghp_abc@github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(stripUrlCredentials('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(stripUrlCredentials('git@github.com:o/r.git')).toBe('git@github.com:o/r.git');
    expect(stripUrlCredentials('/tmp/some/local/repo')).toBe('/tmp/some/local/repo');
  });
});

describe('SimpleGitClient with a token provider (real git, local origin)', () => {
  let root: string;
  let origin: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    origin = join(root, 'origin');
    execFileSync('git', ['init', '-q', '-b', 'main', origin]);
    git(origin, 'config', 'user.email', 't@t');
    git(origin, 'config', 'user.name', 't');
    execFileSync('git', ['-C', origin, 'commit', '-q', '--allow-empty', '-m', 'init']);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('clones with the token supplied out of band, and the remote URL stays plain', async () => {
    const client = new SimpleGitClient(join(root, 'clones'), async () => 'ghp_TESTTOKEN');
    const { path } = await client.clone({ owner: 'o', name: 'r' }, origin);
    expect(git(path, 'remote', 'get-url', 'origin')).toBe(origin);
    expect(git(path, 'config', '--get-all', 'remote.origin.url')).not.toContain('ghp_');
    expect(await client.currentHead({ owner: 'o', name: 'r' })).toMatch(/^[0-9a-f]{40}$/);
  });

  it('re-cloning an existing clone scrubs a token that an older version left in the remote URL', async () => {
    const client = new SimpleGitClient(join(root, 'clones'), async () => 'ghp_TESTTOKEN');
    const { path } = await client.clone({ owner: 'o', name: 'r' }, origin);
    // simulate an old clone made with `https://x-access-token:TOKEN@host/...`
    git(path, 'remote', 'set-url', 'origin', 'https://x-access-token:ghp_OLD@example.invalid/o/r.git');
    await client.clone({ owner: 'o', name: 'r' }, origin).catch(() => undefined); // fetch fails (invalid host); scrub already ran
    expect(git(path, 'remote', 'get-url', 'origin')).toBe('https://example.invalid/o/r.git');
  });
});
