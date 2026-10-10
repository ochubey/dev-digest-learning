import { describe, it, expect } from 'vitest';
import { resolveFeatureModel } from '../src/modules/settings/feature-models.js';

/** Container stub: `rows` are the persisted settings rows, `keys` the configured secrets. */
function makeContainer(opts: { rows?: { key: string; value: unknown }[]; keys?: Record<string, string> }) {
  const db = { select: () => ({ from: () => ({ where: async () => opts.rows ?? [] }) }) };
  const secrets = { get: async (k: string) => opts.keys?.[k] };
  return { db, secrets } as never;
}

describe('resolveFeatureModel key-based fallback', () => {
  it('routes an unset openai default via OpenRouter when only the OpenRouter key exists', async () => {
    const c = makeContainer({ keys: { OPENROUTER_API_KEY: 'or' } });
    expect(await resolveFeatureModel(c, 'w', 'risk_brief')).toEqual({
      provider: 'openrouter',
      model: 'openai/gpt-4.1',
    });
  });

  it('keeps the openai default when the OpenAI key is configured', async () => {
    const c = makeContainer({ keys: { OPENAI_API_KEY: 'oa', OPENROUTER_API_KEY: 'or' } });
    expect(await resolveFeatureModel(c, 'w', 'risk_brief')).toEqual({ provider: 'openai', model: 'gpt-4.1' });
  });

  it('keeps the openai default when no key exists at all (caller reports unavailable)', async () => {
    const c = makeContainer({});
    expect(await resolveFeatureModel(c, 'w', 'conformance')).toEqual({ provider: 'openai', model: 'gpt-4.1' });
  });

  it('leaves openrouter defaults untouched', async () => {
    const c = makeContainer({ keys: { OPENROUTER_API_KEY: 'or' } });
    expect(await resolveFeatureModel(c, 'w', 'onboarding')).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
  });

  it('never rewrites an explicit override', async () => {
    const c = makeContainer({
      rows: [{ key: 'feature_models', value: { risk_brief: { provider: 'openai', model: 'gpt-5' } } }],
      keys: { OPENROUTER_API_KEY: 'or' },
    });
    expect(await resolveFeatureModel(c, 'w', 'risk_brief')).toEqual({ provider: 'openai', model: 'gpt-5' });
  });
});
