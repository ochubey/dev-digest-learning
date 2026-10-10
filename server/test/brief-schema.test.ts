import { describe, it, expect } from 'vitest';
import { PrBrief, Risk } from '@devdigest/shared';
import { toJsonSchema } from '../src/platform/structured.js';
import { BriefModelOutput, PrBriefStored } from '../src/modules/brief/schema.js';
import { RISK_KINDS, BRIEF_MISSING_ORDER } from '../src/modules/brief/constants.js';

const validOut = {
  summary: 's',
  risks: [
    {
      kind: 'security',
      title: 't',
      explanation: 'e',
      severity: 'high',
      file_refs: ['a.ts'],
      anchor_file: null,
      anchor_start_line: null,
      anchor_end_line: null,
    },
  ],
  review_focus: [{ file: 'a.ts', line: 1, reason: 'r' }],
};

function walk(node: unknown, fn: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  if (node && typeof node === 'object') {
    fn(node as Record<string, unknown>);
    Object.values(node).forEach((n) => walk(n, fn));
  }
}

describe('constants', () => {
  it('has 7 risk kinds and canonical missing order from the contract enum', () => {
    expect(RISK_KINDS).toHaveLength(7);
    expect([...BRIEF_MISSING_ORDER]).toEqual([
      'intent',
      'blast',
      'description',
      'linked_issue',
      'specs',
      'diff',
    ]);
  });
});

describe('model output schema is strict-mode safe', () => {
  it('accepts a valid output', () => {
    expect(BriefModelOutput.safeParse(validOut).success).toBe(true);
  });
  it('rejects a missing review_focus', () => {
    const { review_focus: _rf, ...rest } = validOut;
    expect(BriefModelOutput.safeParse(rest).success).toBe(false);
  });
  it('rejects a kind outside RISK_KINDS', () => {
    const bad = { ...validOut, risks: [{ ...validOut.risks[0]!, kind: 'vibes' }] };
    expect(BriefModelOutput.safeParse(bad).success).toBe(false);
  });
  it('emits no length keywords and requires every property', () => {
    const js = toJsonSchema(BriefModelOutput, 'PrBriefOutput');
    const text = JSON.stringify(js);
    for (const k of ['maxLength', 'minLength', 'maxItems', 'minItems']) {
      expect(text).not.toContain(`"${k}"`);
    }
    let objects = 0;
    walk(js, (n) => {
      if (n.properties && typeof n.properties === 'object') {
        objects++;
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties).sort());
        expect(n.additionalProperties).toBe(false);
      }
    });
    expect(objects).toBeGreaterThanOrEqual(3);
  });
  it('requires the three nullable anchor_* keys and has no anchor key', () => {
    const js = toJsonSchema(BriefModelOutput, 'PrBriefOutput');
    let found = false;
    walk(js, (n) => {
      const props = n.properties as Record<string, unknown> | undefined;
      if (props && 'anchor_file' in props) {
        found = true;
        for (const k of ['anchor_file', 'anchor_start_line', 'anchor_end_line']) {
          expect(n.required as string[]).toContain(k);
          expect(JSON.stringify(props[k])).toContain('null');
        }
        expect('anchor' in props).toBe(false);
      }
    });
    expect(found).toBe(true);
    const withValues = {
      ...validOut,
      risks: [{ ...validOut.risks[0]!, anchor_file: 'a.ts', anchor_start_line: 1, anchor_end_line: 2 }],
    };
    expect(BriefModelOutput.safeParse(withValues).success).toBe(true);
  });
  it('rejects a risk missing anchor_end_line', () => {
    const { anchor_end_line: _e, ...r } = validOut.risks[0]!;
    expect(BriefModelOutput.safeParse({ ...validOut, risks: [r] }).success).toBe(false);
  });
  it('has no line_adjusted property', () => {
    expect(JSON.stringify(toJsonSchema(BriefModelOutput, 'PrBriefOutput'))).not.toContain(
      'line_adjusted',
    );
  });
});

const meta = {
  generated_from_head_sha: 'abc',
  generated_at: '2026-01-01T00:00:00.000Z',
  provider: 'openai',
  model: 'gpt-4.1',
  schema_attempts: 1,
  tokens_in: 1,
  tokens_out: 1,
  cost_usd: 0.01,
  missing: [],
  sources: [],
  diff_stats: null,
  input: { estimated_tokens: 10, budget_tokens: 8000, truncated: [], blast_degraded_reason: null },
  grounding: { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0, dropped_anchors: 0 },
};
const storedRisks = [
  { kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: ['a.ts'] },
];
const brief = {
  summary: 's',
  intent: null,
  blast: null,
  risks: { risks: storedRisks },
  review_focus: validOut.review_focus,
  meta,
};

describe('stored schema', () => {
  it('accepts a full grounded fixture', () => {
    expect(PrBriefStored.safeParse(brief).success).toBe(true);
  });
  it('rejects a risk with file_refs: []', () => {
    const bad = { ...brief, risks: { risks: [{ ...storedRisks[0]!, file_refs: [] }] } };
    expect(PrBriefStored.safeParse(bad).success).toBe(false);
  });
  it('rejects an anchor.file that is not one of file_refs, accepts one that is', () => {
    const mk = (file: string) => ({
      ...brief,
      risks: {
        risks: [{ ...storedRisks[0]!, anchor: { file, start_line: 1, end_line: 2 } }],
      },
    });
    expect(PrBriefStored.safeParse(mk('b.ts')).success).toBe(false);
    expect(PrBriefStored.safeParse(mk('a.ts')).success).toBe(true);
  });
  it('a stored risk without anchor still passes', () => {
    expect(PrBriefStored.safeParse(brief).success).toBe(true);
  });
  it('shared Risk and PrBrief still accept []', () => {
    expect(Risk.safeParse({ ...storedRisks[0]!, file_refs: [] }).success).toBe(true);
    const loose = { ...brief, risks: { risks: [{ ...storedRisks[0]!, file_refs: [] }] } };
    expect(PrBrief.safeParse(loose).success).toBe(true);
  });
});
