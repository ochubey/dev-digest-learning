import { describe, it, expect } from 'vitest';
import { sameOrderedList } from '../src/modules/_shared/lists.js';
import { mapLimit } from '../src/modules/project-context/map-limit.js';

describe('sameOrderedList', () => {
  it('is order- and length-sensitive', () => {
    expect(sameOrderedList(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrderedList([], [])).toBe(true);
    expect(sameOrderedList(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrderedList(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('mapLimit', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6, 4, 8]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
