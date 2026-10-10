import { describe, it, expect } from 'vitest';
import {
  Review,
  Finding,
  Intent,
  BlastRadius,
  Risks,
  Risk,
  PrBrief,
  PrHistory,
  SmartDiff,
  SmartDiffRole,
  Conformance,
  Onboarding,
  EvalRun,
  MemoryItem,
  RunTrace,
  Settings,
  Repo,
  PrDetail,
  ContextDoc,
  ContextDiscovery,
  ContextDocPreview,
  AgentContextAttachments,
  ContextAttachmentsInput,
  DefaultContextRepo,
  PROJECT_CONTEXT_FOLDERS,
  PROJECT_CONTEXT_SOURCES,
  PROJECT_CONTEXT_MAX_DISCOVERED,
  PROJECT_CONTEXT_SOFT_CAP_TOKENS,
  PROJECT_CONTEXT_HARD_CEILING_TOKENS,
} from '@devdigest/shared';

/**
 * Contract tests — parse/round-trip the fixtures from data.jsx/data2.jsx
 * so feature agents can rely on the schemas matching the prototype data.
 */

const baseTrace = {
  config: { agent: 'Security Reviewer', model: 'gpt-4.1', pr: 482, source: 'local' },
  stats: { duration_ms: 1, tokens_in: 1, tokens_out: 1, cost_usd: null, findings: 0, grounding: '0/0' },
  tool_calls: [],
  raw_output: '{}',
  memory_pulled: [],
  log: [],
};

describe('AI contracts parse fixtures', () => {
  it('Review + Finding (data.jsx VERDICT/FINDINGS)', () => {
    const review = Review.parse({
      verdict: 'request_changes',
      summary: 'Two blockers before merge.',
      score: 61,
      findings: [
        {
          id: 'f1',
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
          file: 'src/config.ts',
          start_line: 12,
          end_line: 12,
          rationale: 'Line 12 contains a literal `sk_live_` Stripe key.',
          suggestion: 'Move to env and rotate.',
          confidence: 0.98,
          kind: 'secret_leak',
        },
      ],
    });
    expect(review.findings).toHaveLength(1);
    expect(review.score).toBe(61);
  });

  it('lethal-trifecta Finding variant', () => {
    const f = Finding.parse({
      id: 'f2',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Lethal trifecta',
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      rationale: 'all three legs present',
      confidence: 0.79,
      kind: 'lethal_trifecta',
      trifecta_components: ['private_data_access', 'untrusted_input', 'exfil_path'],
      evidence: [{ component: 'untrusted_input', file: 'src/api/public/webhooks.ts', line: 61 }],
    });
    expect(f.trifecta_components).toContain('exfil_path');
  });

  it('Intent / BlastRadius / Risks / PrHistory', () => {
    expect(() =>
      Intent.parse({
        summary: 'x',
        in_scope: ['a'],
        out_of_scope: ['b'],
        confidence: 0.5,
        sources: [],
      }),
    ).not.toThrow();
    expect(() =>
      BlastRadius.parse({
        changed_symbols: [{ name: 'rateLimit', file: 'a.ts', kind: 'function' }],
        downstream: [
          {
            symbol: 'rateLimit',
            callers: [{ name: 'publicRouter', file: 'b.ts', line: 23 }],
            endpoints_affected: ['GET /x'],
            crons_affected: ['c'],
          },
        ],
        summary: 's',
      }),
    ).not.toThrow();
    expect(() =>
      Risks.parse({
        risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      PrHistory.parse({
        history: [
          {
            pr_number: 401,
            title: 't',
            merged_at: '2026-03-18',
            author: 'a',
            files_overlap: [],
            notes: 'n',
          },
        ],
      }),
    ).not.toThrow();
  });

  it('SmartDiff (data.jsx DIFF)', () => {
    const d = SmartDiff.parse({
      groups: [
        {
          role: 'core',
          files: [{ path: 'a.ts', additions: 84, deletions: 0, finding_lines: [28, 52] }],
        },
      ],
      split_suggestion: { too_big: false, total_lines: 285, proposed_splits: [] },
    });
    expect(d.groups[0]!.role).toBe('core');
  });

  it('SmartDiffRole accepts the five roles and rejects unknown ones', () => {
    for (const role of ['core', 'tests', 'wiring', 'docs', 'boilerplate']) {
      expect(SmartDiffRole.safeParse(role).success).toBe(true);
    }
    expect(SmartDiffRole.safeParse('other').success).toBe(false);
  });

  it('Conformance / Onboarding / EvalRun / MemoryItem', () => {
    expect(() =>
      Conformance.parse({
        spec_id: 's1',
        spec_title: 'Spec',
        items: [{ requirement: 'r', status: 'implemented' }],
        completeness_pct: 80,
      }),
    ).not.toThrow();
    expect(() =>
      Onboarding.parse({
        sections: [{ kind: 'architecture', title: 'T', body: 'b', links: [] }],
      }),
    ).not.toThrow();
    expect(() =>
      EvalRun.parse({
        recall: 0.82,
        precision: 0.91,
        citation_accuracy: 0.95,
        traces_passed: 17,
        traces_total: 20,
        duration_ms: 12000,
        cost_usd: 0.23,
        per_trace: [{ name: 't01', pass: true, expected: 'x', actual: 'x' }],
      }),
    ).not.toThrow();
    expect(() =>
      MemoryItem.parse({
        content: 'c',
        scope: 'team',
        kind: 'decision',
        confidence: 0.92,
        sources: [{ pr: 401, context: 'ctx' }],
      }),
    ).not.toThrow();
  });

  it('RunTrace (data2.jsx TRACE single-document)', () => {
    const trace = RunTrace.parse({
      config: { agent: 'Security Reviewer', version: 'v7', model: 'gpt-4.1', pr: 482, source: 'local' },
      stats: { duration_ms: 8200, tokens_in: 14820, tokens_out: 1240, cost_usd: 0.0231, findings: 3, grounding: '3/3 passed' },
      prompt_assembly: { system: 's', user: 'u' },
      tool_calls: [{ tool: 'read_file', args: "'src/config.ts'", meta: '1,240 bytes', ms: 120 }],
      raw_output: '{}',
      memory_pulled: [{ pr: 288, text: 'verified via stripe-signature' }],
      specs_read: ['specs/security-baseline.md'],
      log: [{ t: '00.00', kind: 'info', msg: 'started' }],
    });
    expect(trace.tool_calls).toHaveLength(1);
  });

  it('RunTrace parses legacy specs_read strings + specs string', () => {
    const t = RunTrace.parse({
      ...baseTrace,
      prompt_assembly: { system: 's', user: 'u', specs: '## Specs\nlegacy text' },
      specs_read: ['specs/a.md', 'specs/b.md'],
    });
    expect(t.specs_read).toEqual(['specs/a.md', 'specs/b.md']);
    expect(t.prompt_assembly.specs).toBe('## Specs\nlegacy text');
    expect(t.project_context).toBeUndefined();
    expect(t.prompt_assembly.project_context_blocks).toBeUndefined();
  });

  it('RunTrace parses SpecReadEntry + project_context_blocks', () => {
    const t = RunTrace.parse({
      ...baseTrace,
      prompt_assembly: {
        system: 's',
        user: 'u',
        project_context_blocks: [{ path: 'specs/a.md', tokens: 12, text: '<untrusted source="specs/a.md">x</untrusted>' }],
      },
      specs_read: [
        { path: 'specs/a.md', tokens: 12, status: 'injected', origin: 'agent' },
        { path: 'docs/b.md', tokens: null, status: 'skipped', reason: 'not_found', origin: 'skill', skill_name: 'sec' },
        'legacy.md',
      ],
      project_context: { commit_sha: 'abc123', injected_tokens: 12, soft_cap_exceeded: false },
    });
    expect(t.specs_read).toHaveLength(3);
    expect(t.project_context?.commit_sha).toBe('abc123');
    expect(t.prompt_assembly.project_context_blocks?.[0].tokens).toBe(12);
    expect(() =>
      RunTrace.parse({
        ...baseTrace,
        prompt_assembly: { system: 's', user: 'u' },
        specs_read: [{ path: 'x', tokens: null, status: 'skipped', reason: 'bogus', origin: 'agent' }],
      }),
    ).toThrow();
  });
});

describe('project-context', () => {
  it('ContextDiscovery/AgentContextAttachments parse', () => {
    const doc = { path: 'specs/a.md', name: 'a.md', folder: 'specs', source: 'specs', tokens: 640 };
    const d = ContextDiscovery.parse({ repo_id: 'r1', branch: 'main', commit_sha: 'abc', docs: [doc], total: 1, truncated: false });
    expect(d.docs[0].tokens).toBe(640);
    expect(d.total).toBe(1);
    expect(d.truncated).toBe(false);
    expect(() => ContextDiscovery.parse({ repo_id: 'r1', branch: 'main', commit_sha: 'abc', docs: [doc] })).toThrow();
    for (const source of ['specs', 'docs', 'insights', 'root', 'other']) {
      expect(ContextDoc.parse({ ...doc, source }).source).toBe(source);
    }
    const a = AgentContextAttachments.parse({
      paths: ['specs/a.md'],
      version: 2,
      inherited: [{ path: 'docs/b.md', skill_id: 's1', skill_name: 'Sec' }],
    });
    expect(a.inherited).toHaveLength(1);
    expect(ContextAttachmentsInput.parse({ paths: [] }).paths).toEqual([]);
    expect(DefaultContextRepo.parse({ repo_id: null }).repo_id).toBeNull();
    expect(ContextDocPreview.parse({ path: 'specs/a.md', source: 'specs', tokens: 1, used_by: 3, content: 'x', commit_sha: 'abc' }).used_by).toBe(3);
    expect(() => ContextDoc.parse({ ...doc, source: 'src' })).toThrow();
    expect(PROJECT_CONTEXT_FOLDERS).toEqual(['specs', 'docs', 'insights']);
    expect(PROJECT_CONTEXT_SOURCES).toEqual(['specs', 'docs', 'insights', 'root', 'other']);
    expect(PROJECT_CONTEXT_MAX_DISCOVERED).toBe(500);
    expect(PROJECT_CONTEXT_SOFT_CAP_TOKENS).toBe(4000);
    expect(PROJECT_CONTEXT_HARD_CEILING_TOKENS).toBe(32000);
  });
});

describe('platform DTOs', () => {
  it('Settings defaults + passthrough', () => {
    const s = Settings.parse({ extra_key: 'x' });
    expect(s.theme).toBe('dark');
    expect((s as Record<string, unknown>).extra_key).toBe('x');
  });

  it('Repo + PrDetail', () => {
    expect(() =>
      Repo.parse({
        id: 'r1',
        workspace_id: 'w1',
        owner: 'acme',
        name: 'payments-api',
        full_name: 'acme/payments-api',
        default_branch: 'main',
        clone_path: null,
        last_polled_at: null,
        created_by: null,
      }),
    ).not.toThrow();
    expect(() =>
      PrDetail.parse({
        number: 482,
        title: 't',
        author: 'a',
        branch: 'b',
        base: 'main',
        head_sha: 'sha',
        additions: 1,
        deletions: 0,
        files_count: 1,
        status: 'open',
        files: [],
        commits: [],
      }),
    ).not.toThrow();
  });
});

describe('PrBrief v2', () => {
  const meta = {
    generated_from_head_sha: 'abc123',
    generated_at: '2026-01-01T00:00:00Z',
    provider: 'anthropic',
    model: 'claude-x',
    schema_attempts: 1,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.01,
    missing: ['intent', 'blast'],
    sources: [{ label: 'PR description', status: 'fetched' }],
    diff_stats: { files: 2, additions: 10, deletions: 3, by_role: { core: 1, tests: 1, wiring: 0, docs: 0, boilerplate: 0 } },
    input: { estimated_tokens: 1000, budget_tokens: 8000, truncated: ['diff_stats'], blast_degraded_reason: null },
    grounding: { dropped_risks: 0, dropped_refs: 1, dropped_focus: 0, adjusted_lines: 1 },
  };
  const intent = {
    summary: 's',
    in_scope: ['a'],
    out_of_scope: [],
    confidence: 0.8,
    sources: [{ label: 'PR description', status: 'fetched' }],
  };
  const blast = { changed_symbols: [], downstream: [], summary: 'none' };
  const full = {
    summary: 'Does a thing.',
    intent,
    blast,
    risks: { risks: [{ kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: ['src/a.ts'] }] },
    review_focus: [{ file: 'src/a.ts', line: 3, reason: 'r', line_adjusted: true }],
    history: { history: [] },
    meta,
  };
  const withMeta = (patch: Record<string, unknown>) => ({ ...full, meta: { ...meta, ...patch } });

  it('parses a full fixture', () => {
    expect(PrBrief.safeParse(full).success).toBe(true);
  });

  it('parses intent: null, blast: null with history omitted', () => {
    const { history: _h, ...rest } = full;
    const r = PrBrief.safeParse({ ...rest, intent: null, blast: null });
    expect(r.success).toBe(true);
  });

  it.each(['summary', 'review_focus', 'meta'])('rejects missing %s', (key) => {
    const copy: Record<string, unknown> = { ...full };
    delete copy[key];
    expect(PrBrief.safeParse(copy).success).toBe(false);
  });

  it('shared Risk accepts file_refs: [] (AC-84)', () => {
    expect(Risk.safeParse({ kind: 'security', title: 't', explanation: 'e', severity: 'low', file_refs: [] }).success).toBe(true);
  });

  it('shared Risk accepts any kind string (AC-79)', () => {
    expect(Risk.safeParse({ kind: 'totally_made_up', title: 't', explanation: 'e', severity: 'low', file_refs: [] }).success).toBe(true);
  });

  it('accepts null tokens_in, tokens_out and cost_usd (AC-70)', () => {
    expect(PrBrief.safeParse(withMeta({ tokens_in: null, tokens_out: null, cost_usd: null })).success).toBe(true);
  });

  it('generated_at: Z only (AC-71)', () => {
    expect(PrBrief.safeParse(withMeta({ generated_at: '2026-01-01T00:00:00+02:00' })).success).toBe(false);
    expect(PrBrief.safeParse(withMeta({ generated_at: '2026-01-01' })).success).toBe(false);
    expect(PrBrief.safeParse(withMeta({ generated_at: '2026-01-01T00:00:00Z' })).success).toBe(true);
  });

  it('missing: canonical order accepted, wrong order and duplicates rejected (AC-45)', () => {
    expect(PrBrief.safeParse(withMeta({ missing: ['intent', 'blast', 'description', 'linked_issue', 'specs', 'diff'] })).success).toBe(true);
    expect(PrBrief.safeParse(withMeta({ missing: [] })).success).toBe(true);
    expect(PrBrief.safeParse(withMeta({ missing: ['blast', 'intent'] })).success).toBe(false);
    expect(PrBrief.safeParse(withMeta({ missing: ['intent', 'intent'] })).success).toBe(false);
  });

  it('meta.schema_attempts is required', () => {
    const { schema_attempts: _s, ...noAttempts } = meta;
    expect(PrBrief.safeParse({ ...full, meta: noAttempts }).success).toBe(false);
  });

  it('rejects an unknown meta.missing value', () => {
    expect(PrBrief.safeParse(withMeta({ missing: ['bogus'] })).success).toBe(false);
  });
});

describe('PrBrief rev 4', () => {
  const baseRisk = { kind: 'security', title: 't', explanation: 'e', severity: 'high', file_refs: ['a.ts'] };
  const anchor = { file: 'a.ts', start_line: 12, end_line: 18 };
  const grounding = { dropped_risks: 0, dropped_refs: 0, dropped_focus: 0, adjusted_lines: 0 };
  const meta = {
    generated_from_head_sha: 'abc123',
    generated_at: '2026-01-01T00:00:00Z',
    provider: 'anthropic',
    model: 'claude-x',
    schema_attempts: 1,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.01,
    missing: [],
    sources: [],
    diff_stats: null,
    input: { estimated_tokens: 1000, budget_tokens: 8000, truncated: [], blast_degraded_reason: null },
    grounding,
  };
  const brief = (risk: unknown, g: Record<string, unknown> = grounding) => ({
    summary: 's',
    intent: null,
    blast: null,
    risks: { risks: [risk] },
    review_focus: [],
    meta: { ...meta, grounding: g },
  });

  it('Risk without anchor parses (AC-85)', () => {
    expect(Risk.safeParse(baseRisk).success).toBe(true);
  });

  it('Risk with a valid anchor parses (AC-85)', () => {
    const r = Risk.safeParse({ ...baseRisk, anchor });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.anchor).toEqual(anchor);
  });

  it('rejects start_line: 0', () => {
    expect(Risk.safeParse({ ...baseRisk, anchor: { ...anchor, start_line: 0 } }).success).toBe(false);
  });

  it('rejects end_line < start_line', () => {
    expect(Risk.safeParse({ ...baseRisk, anchor: { ...anchor, end_line: 11 } }).success).toBe(false);
  });

  it('rejects a non-integer start_line', () => {
    expect(Risk.safeParse({ ...baseRisk, anchor: { ...anchor, start_line: 12.5 } }).success).toBe(false);
  });

  it('file_refs: [] and kind: custom still parse', () => {
    expect(Risk.safeParse({ ...baseRisk, file_refs: [], kind: 'custom' }).success).toBe(true);
  });

  it('grounding without dropped_anchors parses and gives 0 (AC-95)', () => {
    const r = PrBrief.safeParse(brief(baseRisk));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.meta.grounding.dropped_anchors).toBe(0);
  });

  it('grounding with dropped_anchors: 3 gives 3 (AC-96)', () => {
    const r = PrBrief.safeParse(brief(baseRisk, { ...grounding, dropped_anchors: 3 }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.meta.grounding.dropped_anchors).toBe(3);
  });

  it('server and client copies parse an anchored fixture identically', async () => {
    const client = (await import('../../client/src/vendor/shared/contracts/brief')) as {
      PrBrief: typeof PrBrief;
    };
    const fixture = brief({ ...baseRisk, anchor }, { ...grounding, dropped_anchors: 2 });
    const a = PrBrief.safeParse(fixture);
    const b = client.PrBrief.safeParse(fixture);
    expect(a.success).toBe(true);
    expect(b).toEqual(a);
  });
});
