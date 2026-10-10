import { describe, it, expect, vi } from 'vitest';
import {
  briefCallsLabel,
  briefLogFields,
  logBriefGeneration,
  classifyLlmError,
  type BriefLogMeta,
} from '../src/modules/brief/log-line.js';
import { TimeoutError } from '../src/platform/resilience.js';
import { ConfigError, ExternalServiceError } from '../src/platform/errors.js';

describe('briefCallsLabel', () => {
  it('covers all 6 outcomes (one call, never "N calls")', () => {
    expect(briefCallsLabel({ calls: 1, outcome: 'ok' })).toBe('brief=1 ok');
    expect(briefCallsLabel({ calls: 1, outcome: 'invalid_output' })).toBe('brief=1 invalid_output');
    expect(briefCallsLabel({ calls: 1, outcome: 'provider_error' })).toBe('brief=1 provider_error');
    expect(briefCallsLabel({ calls: 1, outcome: 'timeout' })).toBe('brief=1 timeout');
    expect(briefCallsLabel({ calls: 0, outcome: 'provider_unavailable' })).toBe(
      'brief=0 provider_unavailable',
    );
    expect(briefCallsLabel({ calls: 0, outcome: 'input_over_budget' })).toBe(
      'brief=0 input_over_budget',
    );
  });
});

const okMeta: BriefLogMeta = {
  prId: 'pr-1',
  outcome: 'ok',
  calls: 1,
  schemaAttempts: 2,
  provider: 'anthropic',
  model: 'claude-x',
  estInputTokens: 4000,
  tokensIn: 3900,
  tokensOut: 300,
  costUsd: 0.012,
  truncated: ['specs'],
  grounding: {
    dropped_risks: 1,
    dropped_refs: 2,
    dropped_focus: 3,
    adjusted_lines: 4,
    dropped_anchors: 5,
  },
  missing: ['intent', 'diff'],
};

describe('briefLogFields', () => {
  it('carries every required field on success', () => {
    expect(briefLogFields(okMeta)).toEqual({
      pr_id: 'pr-1',
      step: 'brief',
      calls: 'brief=1 ok',
      schema_attempts: 2,
      provider: 'anthropic',
      model: 'claude-x',
      est_input_tokens: 4000,
      tokens_in: 3900,
      tokens_out: 300,
      cost_usd: 0.012,
      truncated: ['specs'],
      grounding: {
        dropped_risks: 1,
        dropped_refs: 2,
        dropped_focus: 3,
        adjusted_lines: 4,
        dropped_anchors: 5,
      },
      missing: ['intent', 'diff'],
      outcome: 'ok',
      error_class: null,
      error_message: null,
    });
  });

  it('uses nulls when brief=0 and nothing was resolved or computed, and omits grounding', () => {
    const f = briefLogFields({
      prId: 'pr-2',
      outcome: 'provider_unavailable',
      calls: 0,
      missing: [],
      truncated: [],
      error_class: 'ConfigError',
      error_message: 'The configured provider is not available',
    });
    expect(f.calls).toBe('brief=0 provider_unavailable');
    expect(f.schema_attempts).toBeNull();
    expect(f.provider).toBeNull();
    expect(f.model).toBeNull();
    expect(f.est_input_tokens).toBeNull();
    expect(f.tokens_in).toBeNull();
    expect(f.tokens_out).toBeNull();
    expect(f.cost_usd).toBeNull();
    expect('grounding' in f).toBe(false);
    expect(f.error_class).toBe('ConfigError');
    expect(f.error_message).toBe('The configured provider is not available');
  });

  it('forces schema_attempts to null when calls is 0', () => {
    expect(
      briefLogFields({ ...okMeta, calls: 0, outcome: 'input_over_budget', schemaAttempts: 2 })
        .schema_attempts,
    ).toBeNull();
  });

  it('contains no prompt, document or body text', () => {
    const json = JSON.stringify(briefLogFields(okMeta));
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(
      [
        'calls', 'cost_usd', 'error_class', 'error_message', 'est_input_tokens', 'grounding',
        'missing', 'model', 'outcome', 'pr_id', 'provider', 'schema_attempts', 'step', 'tokens_in',
        'tokens_out', 'truncated',
      ].sort(),
    );
  });
});

describe('logBriefGeneration', () => {
  it('writes exactly one info line (message carries the calls label)', () => {
    const log = { info: vi.fn(), warn: vi.fn() };
    logBriefGeneration(log as never, okMeta);
    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.info.mock.calls[0]!;
    expect(fields.calls).toBe('brief=1 ok');
    expect(msg).toBe('brief: brief=1 ok');
    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe('classifyLlmError', () => {
  const SECRETS = 'PROMPT_SENTINEL_77 sk-test-123';

  it('TimeoutError -> timeout', () => {
    const r = classifyLlmError(new TimeoutError(50_000));
    expect(r.outcome).toBe('timeout');
    expect(r.error_class).toBe('TimeoutError');
  });

  it('schema validation failure message -> invalid_output', () => {
    const r = classifyLlmError(
      new ExternalServiceError('Anthropic structured output failed schema validation', {
        raw: SECRETS,
      }),
    );
    expect(r.outcome).toBe('invalid_output');
    expect(r.error_class).toBe('ExternalServiceError');
  });

  it('OpenRouter plain Error with the same message is invalid_output too', () => {
    expect(
      classifyLlmError(new Error('OpenRouter structured output failed schema validation for X'))
        .outcome,
    ).toBe('invalid_output');
  });

  it('ConfigError -> provider_unavailable', () => {
    const r = classifyLlmError(new ConfigError('no key'));
    expect(r.outcome).toBe('provider_unavailable');
    expect(r.error_class).toBe('ConfigError');
  });

  it('anything else -> provider_error, unknown class names collapse to Error', () => {
    const r = classifyLlmError(Object.assign(new Error('boom'), { name: 'WeirdCustomError' }));
    expect(r.outcome).toBe('provider_error');
    expect(r.error_class).toBe('Error');
    expect(classifyLlmError('a string').outcome).toBe('provider_error');
    expect(classifyLlmError(undefined).error_class).toBe('Error');
  });

  it('adds the HTTP status only when numeric', () => {
    expect(classifyLlmError(Object.assign(new Error('x'), { status: 429 })).error_message).toMatch(/429/);
    expect(classifyLlmError(Object.assign(new Error('x'), { status: '429; DROP' })).error_message).not.toMatch(
      /DROP/,
    );
  });

  it('never copies err.message or err.details', () => {
    const errs = [
      new ExternalServiceError(`OpenAI failed ${SECRETS}`, { prompt: SECRETS }),
      new ExternalServiceError(`Anthropic structured output failed schema validation ${SECRETS}`, {
        raw: SECRETS,
      }),
      new ConfigError(SECRETS, SECRETS),
      Object.assign(new TimeoutError(1), { message: SECRETS, details: SECRETS }),
      Object.assign(new Error(SECRETS), { details: SECRETS, status: 500 }),
    ];
    for (const e of errs) {
      const json = JSON.stringify(classifyLlmError(e));
      expect(json).not.toContain('PROMPT_SENTINEL_77');
      expect(json).not.toContain('sk-test-123');
    }
  });
});
