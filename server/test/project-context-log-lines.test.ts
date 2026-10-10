import { describe, it, expect } from 'vitest';
import {
  projectContextSummaryLine,
  projectContextSkipLine,
} from '../src/modules/project-context/log-lines.js';

describe('project-context log lines', () => {
  it('summary format and plural; skip line names path and reason', () => {
    expect(projectContextSummaryLine({ injected: 2, tokens: 1500, skipped: 1 })).toBe(
      'project context: 2 docs injected, 1500 tokens; 1 skipped',
    );
    expect(projectContextSummaryLine({ injected: 1, tokens: 1, skipped: 0 })).toBe(
      'project context: 1 doc injected, 1 token; 0 skipped',
    );
    expect(projectContextSkipLine('specs/a.md', 'not_found')).toBe(
      'project context: skipped specs/a.md (not_found)',
    );
  });

  it('skip line is single-line ASCII even for hostile paths', () => {
    const line = projectContextSkipLine('specs/a\nb\u2019.md', 'invalid_path');
    expect(line).not.toMatch(/\n/);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
  });
});
