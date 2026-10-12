import { describe, it, expect } from 'vitest';
import { EvalSuiteRun } from '@devdigest/shared';
import { toSuiteRun, toSuiteRunDetail, type SuiteRunRowLike } from '../src/modules/evals/mappers.js';

function row(manifest: unknown): SuiteRunRowLike {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    agentId: '22222222-2222-4222-8222-222222222222',
    agentVersion: 2,
    manifest,
    status: 'completed',
    error: null,
    casesTotal: 1,
    recall: null,
    precision: null,
    citationAccuracy: null,
    counts: null,
    durationMs: null,
    costUsd: null,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: null,
  };
}

describe('eval run mappers: model', () => {
  it('list and detail expose the manifest model', () => {
    const r = row({ model: 'test/model-z' });
    expect(toSuiteRun(r, 0).model).toBe('test/model-z');
    expect(EvalSuiteRun.parse(toSuiteRun(r, 0)).model).toBe('test/model-z');
    expect(toSuiteRunDetail(r, []).model).toBe('test/model-z');
  });

  it('old runs without a model in the manifest give null', () => {
    for (const m of [{}, null, { model: '' }]) expect(toSuiteRun(row(m), 0).model).toBeNull();
    expect(toSuiteRunDetail(row({}), []).model).toBeNull();
  });
});
