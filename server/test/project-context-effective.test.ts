import { describe, it, expect } from 'vitest';
import {
  effectiveDocs,
  validateAttachList,
  countUsedBy,
} from '../src/modules/project-context/effective.js';

const skill = (id: string, name: string, contextPaths: string[], enabled = true) => ({
  id,
  name,
  enabled,
  contextPaths,
});

describe('project-context effective', () => {
  it('skills first in skill order, then agent; first occurrence wins', () => {
    const out = effectiveDocs(
      [skill('s1', 'One', ['docs/a.md', 'specs/b.md']), skill('s2', 'Two', ['specs/b.md', 'docs/c.md'])],
      ['docs/c.md', 'insights/d.md', 'docs/a.md'],
    );
    expect(out).toEqual([
      { path: 'docs/a.md', origin: 'skill', skillId: 's1', skillName: 'One' },
      { path: 'specs/b.md', origin: 'skill', skillId: 's1', skillName: 'One' },
      { path: 'docs/c.md', origin: 'skill', skillId: 's2', skillName: 'Two' },
      { path: 'insights/d.md', origin: 'agent' },
    ]);
  });

  it('empty inputs give an empty list', () => {
    expect(effectiveDocs([], [])).toEqual([]);
  });

  it('rejects duplicates after ./ trim', () => {
    const r = validateAttachList(['specs/a.md', './specs/a.md']);
    expect(r).toEqual({ ok: false, reason: 'duplicate', path: './specs/a.md' });
  });

  it('rejects invalid paths and returns normalized order otherwise', () => {
    expect(validateAttachList(['specs/a.md', '../x.md'])).toEqual({
      ok: false,
      reason: 'invalid_path',
      path: '../x.md',
    });
    expect(validateAttachList(['./docs/b.md', 'specs/a.md'])).toEqual({
      ok: true,
      paths: ['docs/b.md', 'specs/a.md'],
    });
    expect(validateAttachList([])).toEqual({ ok: true, paths: [] });
  });

  it('used-by: A direct + B enabled skill + D both = 3, C disabled skill excluded', () => {
    const P = 'specs/x.md';
    const skills = [skill('sOn', 'On', [P]), skill('sOff', 'Off', [P], false), skill('sNone', 'N', [])];
    const agents = [
      { contextPaths: [P], skillIds: [] }, // A direct
      { contextPaths: [], skillIds: ['sOn'] }, // B via enabled skill
      { contextPaths: [], skillIds: ['sOff'] }, // C via disabled skill
      { contextPaths: [P], skillIds: ['sOn'] }, // D both, counts once
      { contextPaths: ['docs/y.md'], skillIds: ['sNone'] },
    ];
    expect(countUsedBy(P, agents, skills)).toBe(3);
  });
});
