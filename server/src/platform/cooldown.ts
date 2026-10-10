/**
 * In-memory, per-process, per-key admission control: at most one admitted request per key per
 * window, and never a second one while the first is still in flight (a request can outlive the
 * window). Every admitted request counts, whatever its outcome.
 */
export class PerKeyCooldown {
  private lastAdmitted = new Map<string, number>();
  private inFlight = new Set<string>();

  constructor(
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  /** Synchronous check-and-set (no await in between), so concurrent callers cannot both pass. */
  admit(key: string): { ok: true } | { ok: false; retryAfter: number } {
    const nowMs = this.now();
    for (const [k, ts] of this.lastAdmitted) {
      if (nowMs - ts >= this.windowMs && !this.inFlight.has(k)) this.lastAdmitted.delete(k);
    }
    if (this.inFlight.has(key) || this.lastAdmitted.has(key)) {
      return { ok: false, retryAfter: this.retryAfter(key) };
    }
    this.lastAdmitted.set(key, nowMs);
    this.inFlight.add(key);
    return { ok: true };
  }

  /** Whole seconds (>= 1) until the key's window ends; 1 when unknown or in flight past it. */
  retryAfter(key: string): number {
    const last = this.lastAdmitted.get(key);
    if (last === undefined) return 1;
    const remainingMs = last + this.windowMs - this.now();
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  /** Clears the in-flight mark (call from a finally block). The window keeps running. */
  release(key: string): void {
    this.inFlight.delete(key);
  }
}
