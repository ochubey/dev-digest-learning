import { describe, it, expect } from 'vitest';
import { emptyGraphReason } from '../src/modules/repo-intel/pipeline/graph-guard.js';
import { MIN_FILES_FOR_EMPTY_GRAPH_CHECK as MIN } from '../src/modules/repo-intel/constants.js';

describe('emptyGraphReason', () => {
  it('flags zero edges once the repo is big enough to have imports', () => {
    expect(emptyGraphReason(0, MIN)).toContain('empty import graph');
    expect(emptyGraphReason(0, 1565)).toContain('1565 files');
  });

  it('accepts any graph with edges, and tiny repos without edges', () => {
    expect(emptyGraphReason(1, 1565)).toBeUndefined();
    expect(emptyGraphReason(0, MIN - 1)).toBeUndefined();
    expect(emptyGraphReason(0, 0)).toBeUndefined();
  });
});
