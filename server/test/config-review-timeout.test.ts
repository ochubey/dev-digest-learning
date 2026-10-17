import { describe, it, expect } from 'vitest';
import { loadConfig, DEFAULT_REVIEW_RUN_TIMEOUT_MS } from '../src/platform/config.js';

describe('REVIEW_RUN_TIMEOUT_MS config', () => {
  it('defaults to 300000', () => {
    expect(DEFAULT_REVIEW_RUN_TIMEOUT_MS).toBe(300000);
    expect(loadConfig({}).reviewRunTimeoutMs).toBe(300000);
  });
  it('accepts a positive integer', () => {
    expect(loadConfig({ REVIEW_RUN_TIMEOUT_MS: '60000' }).reviewRunTimeoutMs).toBe(60000);
  });
  it.each(['0', '-5', '1.5', 'abc'])('rejects %s', (v) => {
    expect(() => loadConfig({ REVIEW_RUN_TIMEOUT_MS: v })).toThrow();
  });
});
