import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { CI_TRIGGERS, type CiPostAs, type CiTrigger } from '@devdigest/shared';
import { generateWorkflow } from '../src/modules/ci/workflow.js';
import { checkWorkflow } from '../src/modules/ci/workflow-safety.js';

const gen = (triggers: CiTrigger[] = ['opened', 'synchronize'], postAs: CiPostAs = 'github_review') =>
  generateWorkflow({ triggers, postAs });
const doc = (text = gen()) => parse(text, { version: '1.2' }) as any;

const subsets = (): CiTrigger[][] => {
  const out: CiTrigger[][] = [];
  for (let mask = 1; mask < 1 << CI_TRIGGERS.length; mask++) {
    out.push(CI_TRIGGERS.filter((_, i) => mask & (1 << i)));
  }
  return out;
};

describe('generated workflow', () => {
  it('AC-19 header', () => {
    expect(gen().startsWith('# devdigest-workflow-version: 1\n')).toBe(true);
  });

  it('AC-20 permissions map exact', () => {
    const d = doc();
    expect(d.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(d.jobs['devdigest-review'].permissions).toBeUndefined();
  });

  it('AC-21 every trigger combination; no pull_request_target/workflow_run/issue_comment/push', () => {
    for (const subset of subsets()) {
      const text = gen(subset);
      const d = doc(text);
      expect(Object.keys(d.on)).toEqual(['pull_request']);
      expect(d.on.pull_request.types).toEqual(subset);
      for (const bad of ['pull_request_target', 'workflow_run', 'issue_comment', 'push']) {
        expect(text).not.toMatch(new RegExp(`\\b${bad}\\b`));
      }
    }
  });

  it('AC-21 triggers come out in canonical order whatever the input order', () => {
    expect(doc(gen(['reopened', 'opened'])).on.pull_request.types).toEqual(['opened', 'reopened']);
  });

  it('AC-22 base.sha checkout + persist-credentials false', () => {
    const steps = doc().jobs['devdigest-review'].steps;
    const checkouts = steps.filter((s: any) => s.uses?.startsWith('actions/checkout@'));
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].with.ref).toBe('${{ github.event.pull_request.base.sha }}');
    expect(checkouts[0].with['persist-credentials']).toBe(false);
    expect(gen()).not.toContain('head.sha');
  });

  it('AC-23 job-level fork guard', () => {
    const job = doc().jobs['devdigest-review'];
    expect(job.if).toBe('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('AC-24 only occurrence of OPENROUTER_API_KEY is the step env secret', () => {
    const text = gen();
    const hits = text.match(/OPENROUTER_API_KEY/g) ?? [];
    // exactly the env key and its secret reference
    expect(hits).toHaveLength(2);
    const step = doc().jobs['devdigest-review'].steps.find((s: any) => s.env);
    expect(step.env.OPENROUTER_API_KEY).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    expect(text.match(/secrets\./g)).toHaveLength(1);
  });

  it('AC-25 no ${{ in any run:', () => {
    const steps = doc().jobs['devdigest-review'].steps;
    for (const s of steps) if (s.run) expect(s.run).not.toContain('${{');
    expect(steps.some((s: any) => s.run)).toBe(true);
  });

  it('AC-26 every uses: matches @[0-9a-f]{40}', () => {
    const uses = doc().jobs['devdigest-review'].steps.map((s: any) => s.uses).filter(Boolean);
    expect(uses.length).toBe(3);
    for (const u of uses) expect(u).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
    expect(gen()).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+/);
  });

  it('AC-27 upload if: always() + if-no-files-found: ignore + name devdigest-result', () => {
    const up = doc().jobs['devdigest-review'].steps.find((s: any) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(up.if).toBe('always()');
    expect(up.with['if-no-files-found']).toBe('ignore');
    expect(up.with.name).toBe('devdigest-result');
    expect(up.with.path).toBe('devdigest-result.json');
  });

  it('AC-28 hashFiles condition on the review step', () => {
    const run = doc().jobs['devdigest-review'].steps.find((s: any) => s.run);
    expect(run.if).toBe("hashFiles('.devdigest/runner/index.js') != ''");
    expect(run.run).toBe('node .devdigest/runner/index.js');
  });

  it('AC-33 DEVDIGEST_POST_AS per option', () => {
    for (const mode of ['github_review', 'pr_comment', 'none'] as const) {
      const step = doc(gen(['opened'], mode)).jobs['devdigest-review'].steps.find((s: any) => s.env);
      expect(step.env.DEVDIGEST_POST_AS).toBe(mode);
    }
  });

  it('is deterministic and uses Node 22', () => {
    expect(gen()).toBe(gen());
    const setup = doc().jobs['devdigest-review'].steps.find((s: any) => s.uses?.startsWith('actions/setup-node@'));
    expect(setup.with['node-version']).toBe(22);
  });

  it('generated workflow passes checkWorkflow', () => {
    for (const subset of subsets()) {
      for (const mode of ['github_review', 'pr_comment', 'none'] as const) {
        expect(checkWorkflow(gen(subset, mode))).toEqual({ ok: true });
      }
    }
  });
});
