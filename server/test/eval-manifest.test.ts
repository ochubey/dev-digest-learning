import { describe, it, expect } from 'vitest';
import { AgentVersionConfig } from '@devdigest/shared';
import { versionConfigOf } from '../src/platform/agent-config.js';
import type { AgentRow } from '../src/db/rows.js';

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  systemPrompt: 'Review carefully.',
  outputSchema: { type: 'object' },
  strategy: 'single-pass',
  ciFailOn: 'critical',
  repoIntel: true,
  contextPaths: ['docs/'],
} as unknown as AgentRow;

describe('versionConfigOf', () => {
  it('equals the snapshot shape', () => {
    const cfg = versionConfigOf(row, ['s1', 's2']);
    expect(cfg).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      system_prompt: 'Review carefully.',
      output_schema: { type: 'object' },
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skills: ['s1', 's2'],
      context_paths: ['docs/'],
    });
    // The public DTO schema accepts the snapshot (it strips the internal context_paths).
    expect(AgentVersionConfig.safeParse(cfg).success).toBe(true);
  });
});
