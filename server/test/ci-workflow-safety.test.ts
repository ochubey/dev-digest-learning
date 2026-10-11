import { describe, it, expect } from 'vitest';
import { generateWorkflow } from '../src/modules/ci/workflow.js';
import { checkWorkflow } from '../src/modules/ci/workflow-safety.js';

const base = () => generateWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
const rule = (text: string) => {
  const r = checkWorkflow(text);
  return r.ok ? 'ok' : r.rule;
};
const SHA = 'a'.repeat(40);

describe('checkWorkflow', () => {
  it('the unmodified generated workflow is ok', () => {
    expect(checkWorkflow(base())).toEqual({ ok: true });
  });

  const cases: [string, (t: string) => string, string][] = [
    ['invalid YAML', () => 'on: [unclosed\n  jobs: {', 'yaml_invalid'],
    ['duplicate keys', (t) => t + 'permissions:\n  contents: read\n', 'yaml_invalid'],
    ['not a mapping', () => '- a\n- b\n', 'yaml_invalid'],
    ['extra permission', (t) => t.replace('  pull-requests: write\n', '  pull-requests: write\n  issues: write\n'), 'permissions_widened'],
    ['write-all', (t) => t.replace(/permissions:\n  contents: read\n  pull-requests: write\n/, 'permissions: write-all\n'), 'permissions_widened'],
    ['contents: write', (t) => t.replace('contents: read', 'contents: write'), 'permissions_widened'],
    ['permissions removed', (t) => t.replace(/permissions:\n  contents: read\n  pull-requests: write\n/, ''), 'permissions_widened'],
    ['job-level permissions', (t) => t.replace('    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n'), 'permissions_widened'],
    ['pull_request_target', (t) => t.replace('  pull_request:\n', '  pull_request_target:\n'), 'forbidden_trigger'],
    ['extra push trigger', (t) => t.replace('on:\n', 'on:\n  push:\n    branches: [main]\n'), 'forbidden_trigger'],
    ['workflow_run trigger', (t) => t.replace(/on:\n  pull_request:\n    types: \[.*\]\n/, 'on:\n  workflow_run:\n    workflows: [x]\n'), 'forbidden_trigger'],
    ['fork guard removed', (t) => t.replace(/    if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository\n/, ''), 'fork_guard_missing'],
    ['fork guard made optional with ||', (t) => t.replace('== github.repository', '== github.repository || true'), 'fork_guard_missing'],
    ['fork guard compares another value', (t) => t.replace('== github.repository', '!= github.repository'), 'fork_guard_missing'],
    ['base checkout removed', (t) => t.replace(/      - uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n        with:\n          ref: .*\n          persist-credentials: false\n/, ''), 'base_checkout_missing'],
    ['checkout of the head', (t) => t.replace('pull_request.base.sha', 'pull_request.head.sha'), 'base_checkout_missing'],
    ['persist-credentials true', (t) => t.replace('persist-credentials: false', 'persist-credentials: true'), 'base_checkout_missing'],
    ['tag-pinned action', (t) => t.replace(/actions\/setup-node@[0-9a-f]{40}/, 'actions/setup-node@v4'), 'action_not_pinned'],
    ['short-sha action', (t) => t.replace(/actions\/setup-node@[0-9a-f]{40}/, 'actions/setup-node@abc1234'), 'action_not_pinned'],
    ['${{ in run', (t) => t.replace('run: node .devdigest/runner/index.js', 'run: echo ${{ github.event.pull_request.title }}'), 'expression_in_run'],
    ['OPENROUTER_API_KEY literal', (t) => t.replace('${{ secrets.OPENROUTER_API_KEY }}', 'sk-or-literal'), 'secret_misassigned'],
    ['OPENROUTER_API_KEY other expression', (t) => t.replace('${{ secrets.OPENROUTER_API_KEY }}', '${{ secrets.OTHER }}'), 'secret_misassigned'],
    ['secret passed under another name', (t) => t.replace('DEVDIGEST_POST_AS: github_review', 'DEVDIGEST_POST_AS: github_review\n          LEAK: ${{ secrets.OPENROUTER_API_KEY }}'), 'secret_misassigned'],
    ['other secret used', (t) => t.replace('PR_NUMBER:', 'EXTRA: ${{ secrets.GH_PAT }}\n          PR_NUMBER:'), 'secret_misassigned'],
  ];

  it('AC-29: one case per rule (invalid YAML, extra permission, write-all, job-level permissions, pull_request_target, fork guard removed, base checkout removed, tag-pinned action, ${{ in run, OPENROUTER_API_KEY assigned a literal / other expression / passed under another name) -> rule name', () => {
    for (const [label, mutate, expected] of cases) {
      const text = mutate(base());
      expect(text === base() ? `${label}: mutation had no effect` : rule(text), label).toBe(expected);
    }
  });

  it('every check returns a human message', () => {
    const r = checkWorkflow(base().replace('pull_request:', 'pull_request_target:'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
  });

  it('a pinned third-party action with a 40-hex SHA is accepted', () => {
    const t = base().replace(
      '      - uses: actions/setup-node',
      `      - uses: some/action@${SHA}\n      - uses: actions/setup-node`,
    );
    expect(rule(t)).toBe('ok');
  });

  it('AC-30: node-version 20 edit passes', () => {
    expect(checkWorkflow(base().replace('node-version: 22', 'node-version: 20'))).toEqual({ ok: true });
  });

  it('AC-30: a comment-only edit passes', () => {
    expect(checkWorkflow(base() + '# team note\n')).toEqual({ ok: true });
  });
});
