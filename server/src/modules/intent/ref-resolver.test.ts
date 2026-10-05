import { describe, it, expect, vi } from 'vitest';
import { RefResolver } from './ref-resolver.js';
import type { GitHubClient } from '../../vendor/shared/adapters.js';

const repo = { owner: 'o', name: 'r' };
const KB = 1024;

function resolverWithDoc(doc: string) {
  const github = {
    getIssue: async () => null,
    readRepoFile: async () => doc,
  } as unknown as GitHubClient;
  return new RefResolver(github);
}

async function planContent(doc: string): Promise<string> {
  const res = await resolverWithDoc(doc).resolveRefs(repo, 't', 'See docs/plan.md', 'sha');
  return res.planDoc!.content;
}

describe('RefResolver doc size limits', () => {
  it('leaves docs under 32 KB untouched', async () => {
    const doc = 'HEAD' + 'x'.repeat(31 * KB) + 'TAIL';
    expect(await planContent(doc)).toBe(doc);
  });

  it('shortens 32-64 KB docs to 32 KB, keeping the head and the last 1 KB', async () => {
    const doc = 'HEAD-START' + 'x'.repeat(40 * KB) + 'z'.repeat(KB - 3) + 'END';
    const out = await planContent(doc);
    expect(out.length).toBeLessThanOrEqual(32 * KB);
    expect(out.startsWith('HEAD-START')).toBe(true);
    expect(out.endsWith('END')).toBe(true);
    expect(out).toContain('[... truncated ...]');
  });

  it('caps docs over 64 KB, keeping the head (never only the last 1 KB)', async () => {
    const doc = 'HEAD-START' + 'x'.repeat(100 * KB) + 'END';
    const out = await planContent(doc);
    expect(out.length).toBeLessThanOrEqual(32 * KB);
    expect(out.length).toBeGreaterThan(KB);
    expect(out.startsWith('HEAD-START')).toBe(true);
    expect(out).not.toContain('END');
  });

  it('applies the same limits to the linked issue body', async () => {
    const github = {
      getIssue: async () => ({ title: 'i', body: 'ISSUE-HEAD' + 'y'.repeat(100 * KB) }),
      readRepoFile: async () => null,
    } as unknown as GitHubClient;
    const res = await new RefResolver(github).resolveRefs(repo, 't', 'closes #5', 'sha');
    expect(res.linkedIssue!.body.startsWith('ISSUE-HEAD')).toBe(true);
    expect(res.linkedIssue!.body.length).toBeLessThanOrEqual(32 * KB);
  });
});

// ---------------------------------------------------------------------------
// Issue reference parsing + source statuses
// ---------------------------------------------------------------------------
import { extractIssueRef } from './ref-resolver.js';
import { MockGitHubClient } from '../../adapters/mocks.js';

describe('extractIssueRef', () => {
  it('keeps the keyword forms (fixes/closes/resolves #N)', () => {
    for (const kw of ['fixes', 'Closes', 'resolved', 'Fixed:']) {
      expect(extractIssueRef(repo, 't', `${kw} #12`).number).toBe(12);
    }
  });

  it('parses a bare #N from the body', () => {
    expect(extractIssueRef(repo, 't', 'relates to #7 somehow').number).toBe(7);
  });

  it('parses a same-repo full GitHub issue URL (case-insensitive repo)', () => {
    const r = extractIssueRef(repo, 't', 'see https://github.com/O/R/issues/33 for context');
    expect(r.number).toBe(33);
    expect(r.crossRepo).toEqual([]);
  });

  it('parses the reference from the PR title when the body has none', () => {
    expect(extractIssueRef(repo, 'Fix crash (#45)', '').number).toBe(45);
    expect(extractIssueRef(repo, 'Closes https://github.com/o/r/issues/46', 'no refs').number).toBe(46);
  });

  it('ignores other-repo URLs and owner/repo#N, and marks them', () => {
    const r = extractIssueRef(
      repo,
      't',
      'closes https://github.com/other/repo/issues/9 and fixes x/y#3',
    );
    expect(r.number).toBeUndefined();
    expect(r.crossRepo).toEqual(['other/repo#9', 'x/y#3']);
  });

  it('treats owner/repo#N pointing at this repo as a same-repo reference', () => {
    expect(extractIssueRef(repo, 't', 'see o/r#8').number).toBe(8);
  });

  it('skips a cross-repo ref and still finds a same-repo one', () => {
    const r = extractIssueRef(repo, 't', 'https://github.com/a/b/issues/1 then fixes #2');
    expect(r.number).toBe(2);
    expect(r.crossRepo).toEqual(['a/b#1']);
  });

  it('precedence: keyword > URL > bare; body before title; first match wins', () => {
    // bare earlier in the text, keyword later -> keyword wins
    expect(extractIssueRef(repo, 't', 'see #1, also fixes #2').number).toBe(2);
    // URL beats bare
    expect(extractIssueRef(repo, 't', '#1 and https://github.com/o/r/issues/2').number).toBe(2);
    // keyword in the title beats a bare number in the body
    expect(extractIssueRef(repo, 'Fixes #5', 'related to #6').number).toBe(5);
    // same tier: body before title
    expect(extractIssueRef(repo, 'Fixes #5', 'closes #6').number).toBe(6);
    // same tier + same text: first match wins
    expect(extractIssueRef(repo, 't', 'fixes #3 and fixes #4').number).toBe(3);
  });

  it('does not read anchors inside URLs as issue refs', () => {
    expect(extractIssueRef(repo, 't', 'https://github.com/o/r/pull/3#5 and https://x.dev/p#12').number).toBeUndefined();
    expect(extractIssueRef(repo, 't', 'https://github.com/o/r/pull/3#discussion_r5').number).toBeUndefined();
  });

  it('no match -> nothing', () => {
    expect(extractIssueRef(repo, 'Add feature', 'no refs here')).toEqual({ crossRepo: [] });
  });
});

describe('RefResolver source statuses', () => {
  it('fetched issue + fetched plan produce fetched statuses and labelled sources', async () => {
    const gh = new MockGitHubClient({ files: { 'docs/plan.md': 'the plan' } });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'closes #12, see docs/plan.md', 'sha');
    expect(res.linkedIssue?.title).toBe('Issue #12');
    expect(res.sourceStatuses).toEqual({ linked_issue: 'fetched', 'plan_at_docs/plan.md': 'fetched' });
    expect(res.sources).toEqual([
      { label: 'Linked issue #12', status: 'fetched' },
      { label: 'Plan at docs/plan.md', status: 'fetched' },
    ]);
  });

  it('no references -> no statuses (nothing is claimed unavailable)', async () => {
    const res = await new RefResolver(new MockGitHubClient()).resolveRefs(repo, 'Add x', 'plain', 'sha');
    expect(res.sourceStatuses).toEqual({});
    expect(res.sources).toEqual([]);
  });

  it('referenced-but-missing doc and 404 issue are "unavailable"', async () => {
    const gh = new MockGitHubClient({ files: { 'docs/spec.md': null }, issues: { 5: null } });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'fixes #5 per docs/spec.md', 'sha');
    expect(res.sourceStatuses).toEqual({
      linked_issue: 'unavailable',
      'spec_at_docs/spec.md': 'unavailable',
    });
    expect(res.specDoc).toBeUndefined();
  });

  it('non-404 failures (auth / rate limit / network) are "error", fail-open (never throws)', async () => {
    const gh = new MockGitHubClient({
      files: { 'docs/plan.md': Object.assign(new Error('Bad credentials'), { status: 401 }) },
      issues: { 5: new Error('socket hang up') },
    });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'fixes #5 see docs/plan.md', 'sha');
    expect(res.sourceStatuses).toEqual({ linked_issue: 'error', 'plan_at_docs/plan.md': 'error' });
    expect(res.linkedIssue).toBeUndefined();
    expect(res.planDoc).toBeUndefined();
  });

  it('cross-repo reference is marked unavailable and never fetched', async () => {
    const gh = new MockGitHubClient();
    const spy = vi.spyOn(gh, 'getIssue');
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'fixes https://github.com/a/b/issues/9', 'sha');
    expect(spy).not.toHaveBeenCalled();
    expect(res.sourceStatuses).toEqual({ 'issue_a/b#9': 'unavailable' });
    expect(res.sources).toEqual([{ label: 'Issue a/b#9 (other repository)', status: 'unavailable' }]);
  });

  it('resolves an issue referenced only in the title', async () => {
    const res = await new RefResolver(new MockGitHubClient()).resolveRefs(repo, 'Fix (#21)', '', 'sha');
    expect(res.linkedIssue?.title).toBe('Issue #21');
  });
});

import { extractDocPaths } from './ref-resolver.js';

describe('extractDocPaths', () => {
  it('parses server/docs/architecture.md as a whole (never cut down to docs/architecture.md)', () => {
    expect(extractDocPaths('4. `server/docs/architecture.md`, `server/specs/review-flow.md` exist')).toEqual([
      'server/docs/architecture.md',
    ]);
  });

  it('keeps docs/ paths, *spec.md and *plan.md names, strips ./, dedupes, ignores URLs and other .md', () => {
    const text = [
      'see ./docs/plans/a.md and docs/plans/a.md,',
      'also reviewer-core/docs/architecture.md, PLAN.md, api-spec.md.',
      'README.md and src/notes.md are not plans.',
      'https://example.com/docs/guide.md is a link, not a repo path.',
    ].join(' ');
    expect(extractDocPaths(text)).toEqual([
      'docs/plans/a.md',
      'reviewer-core/docs/architecture.md',
      'PLAN.md',
      'api-spec.md',
    ]);
  });
});

describe('implicit references', () => {
  it('"seeded PR #482" is not a reference at all', () => {
    expect(extractIssueRef(repo, 't', 'run it on seeded PR #482 and look').number).toBeUndefined();
    expect(extractIssueRef(repo, 't', 'see pull request #9').number).toBeUndefined();
  });

  it('keyword (incl. "issue") and URL forms are explicit; a bare #N is implicit', () => {
    expect(extractIssueRef(repo, 't', 'fixes #1').explicit).toBe(true);
    expect(extractIssueRef(repo, 't', 'issue #2').explicit).toBe(true);
    expect(extractIssueRef(repo, 't', 'https://github.com/o/r/issues/3').explicit).toBe(true);
    expect(extractIssueRef(repo, 't', 'o/r#4').explicit).toBe(true);
    expect(extractIssueRef(repo, 't', 'relates to #5').explicit).toBe(false);
  });

  it('an implicit bare #N that 404s silently drops (no source, no warning)', async () => {
    const gh = new MockGitHubClient({ issues: { 7: null } });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'relates to #7', 'sha');
    expect(res.sources).toEqual([]);
    expect(res.sourceStatuses).toEqual({});
  });

  it('an implicit bare #N that resolves is still used as the linked issue', async () => {
    const res = await new RefResolver(new MockGitHubClient()).resolveRefs(repo, 't', 'relates to #7', 'sha');
    expect(res.linkedIssue?.title).toBe('Issue #7');
    expect(res.sourceStatuses).toEqual({ linked_issue: 'fetched' });
  });

  it('an EXPLICIT reference that 404s is still reported as unavailable', async () => {
    const gh = new MockGitHubClient({ issues: { 7: null } });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'closes #7', 'sha');
    expect(res.sourceStatuses).toEqual({ linked_issue: 'unavailable' });
  });

  it('an implicit bare #N with a non-404 failure is still an error (not silently hidden)', async () => {
    const gh = new MockGitHubClient({ issues: { 7: new Error('socket hang up') } });
    const res = await new RefResolver(gh).resolveRefs(repo, 't', 'relates to #7', 'sha');
    expect(res.sourceStatuses).toEqual({ linked_issue: 'error' });
  });

  it('the real PR body: server/docs/architecture.md is fetched at its full path, seeded PR #482 adds no source', async () => {
    const body = 'seeded PR #482 -> run card.\n4. `server/docs/architecture.md`, `server/specs/review-flow.md` exist';
    const gh = new MockGitHubClient({ files: { 'server/docs/architecture.md': 'arch', 'docs/architecture.md': null } });
    const res = await new RefResolver(gh).resolveRefs(repo, 'feat: L01', body, 'sha');
    expect(res.sourceStatuses).toEqual({ 'plan_at_server/docs/architecture.md': 'fetched' });
    expect(res.sources).toEqual([{ label: 'Plan at server/docs/architecture.md', status: 'fetched' }]);
  });
});
