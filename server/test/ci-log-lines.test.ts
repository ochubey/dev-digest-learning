import { describe, it, expect } from 'vitest';
import { exportLine, rejectLine, syncLine } from '../src/modules/ci/log-lines.js';

describe('ci log lines', () => {
  it('export/sync/reject lines carry ids, codes, rules; never a token, key or artifact body', () => {
    const exp = exportLine({ agentId: 'a1', repo: 'acme/widgets', mode: 'open_pr', outcome: 'error', code: 'github_write_denied' });
    expect(exp).toBe('ci.export agent=a1 repo=acme/widgets mode=open_pr outcome=error code=github_write_denied');
    expect(exportLine({ agentId: 'a1', repo: 'r', mode: 'files', outcome: 'ok' })).toContain('code=null');

    const sync = syncLine({
      repo: 'acme/widgets',
      installationId: 'i1',
      seen: 3,
      ingested: 1,
      rejected: 2,
      rules: ['commit_sha_mismatch', 'schema_invalid'],
    });
    expect(sync).toBe('ci.sync repo=acme/widgets installation=i1 seen=3 ingested=1 rejected=2 rules=commit_sha_mismatch,schema_invalid code=null');
    expect(syncLine({ repo: 'r', installationId: 'i', seen: 0, ingested: 0, rejected: 0, rules: [] })).toContain('rules=none');

    expect(rejectLine({ installationId: 'i1', runId: 5001, rule: 'pr_number_mismatch' })).toBe(
      'ci.sync reject installation=i1 run=5001 rule=pr_number_mismatch',
    );
  });

  it('builders have no parameter that could carry secrets: extra fields are not rendered', () => {
    const line = exportLine({
      agentId: 'a1',
      repo: 'r',
      mode: 'open_pr',
      outcome: 'ok',
      token: 'ghp_SECRET',
      contents: 'FILE-BODY',
    } as never);
    expect(line).not.toContain('ghp_SECRET');
    expect(line).not.toContain('FILE-BODY');
    const rej = rejectLine({ installationId: 'i', runId: 1, rule: 'r', artifact: 'ART-TEXT' } as never);
    expect(rej).not.toContain('ART-TEXT');
    const sync = syncLine({ repo: 'r', installationId: 'i', seen: 0, ingested: 0, rejected: 0, rules: [], key: 'sk-or-x' } as never);
    expect(sync).not.toContain('sk-or-x');
  });
});
