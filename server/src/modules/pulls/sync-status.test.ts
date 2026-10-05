import { describe, it, expect } from 'vitest';
import { classifyGithubError, getSync, recordSync } from './sync-status.js';

describe('classifyGithubError', () => {
  it('401 -> bad_credentials, with the docs URL stripped from the message', () => {
    const r = classifyGithubError({ status: 401, message: 'Bad credentials - https://docs.github.com/rest' });
    expect(r).toEqual({ reason: 'bad_credentials', status: 401, message: 'Bad credentials' });
  });

  it('404 and plain 403 -> no_access', () => {
    expect(classifyGithubError({ status: 404, message: 'Not Found' }).reason).toBe('no_access');
    expect(classifyGithubError({ status: 403, message: 'Forbidden' }).reason).toBe('no_access');
  });

  it('429 and 403 with exhausted rate limit -> rate_limited', () => {
    expect(classifyGithubError({ status: 429, message: 'slow down' }).reason).toBe('rate_limited');
    expect(
      classifyGithubError({ status: 403, message: 'rate limit', response: { headers: { 'x-ratelimit-remaining': '0' } } })
        .reason,
    ).toBe('rate_limited');
  });

  it('missing token -> no_token; anything else -> error', () => {
    expect(classifyGithubError(new Error('GITHUB_TOKEN is not configured')).reason).toBe('no_token');
    expect(classifyGithubError(new Error('socket hang up')).reason).toBe('error');
  });
});

describe('sync status store', () => {
  it('is ok when never attempted, then reflects the last attempt per repo', () => {
    expect(getSync('r-unknown').ok).toBe(true);
    recordSync('r1', { ok: false, reason: 'bad_credentials', status: 401, message: 'Bad credentials' });
    expect(getSync('r1')).toMatchObject({ ok: false, reason: 'bad_credentials', status: 401 });
    recordSync('r1', { ok: true });
    expect(getSync('r1').ok).toBe(true);
    expect(getSync('r2').ok).toBe(true);
  });
});
