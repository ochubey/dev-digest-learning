import { describe, it, expect, vi } from 'vitest';
import { PerKeyCooldown } from '../src/platform/cooldown.js';

function make(windowMs = 30_000) {
  const clock = { t: 1_000_000 };
  const cd = new PerKeyCooldown(windowMs, () => clock.t);
  return { clock, cd };
}

describe('PerKeyCooldown', () => {
  it('admits the first request and blocks a second within the window', () => {
    const { clock, cd } = make();
    expect(cd.admit('a')).toEqual({ ok: true });
    cd.release('a');
    clock.t += 10_000;
    expect(cd.admit('a')).toEqual({ ok: false, retryAfter: 20 });
  });

  it('admits again once the window has passed', () => {
    const { clock, cd } = make();
    cd.admit('a');
    cd.release('a');
    clock.t += 30_000;
    expect(cd.admit('a')).toEqual({ ok: true });
  });

  it('keys are independent', () => {
    const { cd } = make();
    expect(cd.admit('a').ok).toBe(true);
    expect(cd.admit('b').ok).toBe(true);
  });

  it('blocks while in flight even beyond the window, with retryAfter >= 1', () => {
    const { clock, cd } = make();
    cd.admit('a');
    clock.t += 40_000;
    expect(cd.admit('a')).toEqual({ ok: false, retryAfter: 1 });
    cd.release('a');
    // Released after the window: admitted again.
    expect(cd.admit('a')).toEqual({ ok: true });
  });

  it('release clears in-flight but the window still blocks', () => {
    const { clock, cd } = make();
    cd.admit('a');
    cd.release('a');
    clock.t += 1000;
    expect(cd.admit('a').ok).toBe(false);
  });

  it('retryAfter rounds up and is at least 1', () => {
    const { clock, cd } = make();
    cd.admit('a');
    cd.release('a');
    clock.t += 800;
    expect(cd.admit('a')).toEqual({ ok: false, retryAfter: 30 });
    clock.t += 29_100;
    expect(cd.admit('a')).toEqual({ ok: false, retryAfter: 1 });
  });

  it('purges expired entries but never an in-flight one', () => {
    const { clock, cd } = make();
    cd.admit('a'); // stays in flight
    cd.admit('b');
    cd.release('b');
    clock.t += 31_000;
    expect(cd.admit('c').ok).toBe(true); // triggers the purge
    expect(cd.admit('a').ok).toBe(false); // in flight, kept
    expect(cd.admit('b').ok).toBe(true); // expired and purged
  });

  it('retryAfter: rounds up, floors at 1, and is 1 for an unknown key', () => {
    const { clock, cd } = make();
    expect(cd.retryAfter('nope')).toBe(1);
    cd.admit('a');
    clock.t += 10_000;
    expect(cd.retryAfter('a')).toBe(20);
    clock.t += 9_100; // 10.9 s left
    expect(cd.retryAfter('a')).toBe(11);
    clock.t += 10_850; // 0.05 s left
    expect(cd.retryAfter('a')).toBe(1);
  });

  it('retryAfter is 1 for a request still in flight past the window', () => {
    const { clock, cd } = make();
    cd.admit('a');
    clock.t += 40_000;
    expect(cd.retryAfter('a')).toBe(1);
  });

  it('the default clock is Date.now', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const cd = new PerKeyCooldown(30_000);
      expect(cd.admit('a').ok).toBe(true);
      cd.release('a');
      vi.setSystemTime(new Date('2026-01-01T00:00:10Z'));
      expect(cd.admit('a')).toEqual({ ok: false, retryAfter: 20 });
      vi.setSystemTime(new Date('2026-01-01T00:00:30Z'));
      expect(cd.admit('a')).toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('repeated synchronous admits of one key: exactly one ok', () => {
    const { cd } = make();
    const results = Array.from({ length: 5 }, () => cd.admit('a'));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});
