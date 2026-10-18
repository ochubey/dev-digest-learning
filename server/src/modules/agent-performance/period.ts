import { z } from 'zod';
import { DAY_MS, DEFAULT_DAYS, MAX_RANGE_DAYS } from './constants.js';

export interface Period {
  from: Date;
  to: Date;
}

/** ISO-8601 instant that carries an explicit zone: `Z` or `+hh:mm` / `-hh:mm`. */
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Parsed epoch ms, or NaN when the text is not a real instant (e.g. Feb 30). */
function parseInstant(v: string): number {
  const m = ISO_INSTANT.exec(v);
  if (!m) return NaN;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Date.parse may roll an impossible day over; check the calendar date explicitly.
  const cal = new Date(Date.UTC(y, mo - 1, d));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== mo - 1 || cal.getUTCDate() !== d) return NaN;
  return Date.parse(v);
}

/**
 * `?from=&to=` for both endpoints: both or none, valid ISO instants with a zone,
 * `from < to`, at most 366 days. Never reaches SQL as text: it is parsed to Dates.
 */
export const PeriodQuery = z
  .object({ from: z.string().optional(), to: z.string().optional() })
  .superRefine((q, ctx) => {
    if (q.from === undefined && q.to === undefined) return;
    if (q.from === undefined || q.to === undefined) {
      ctx.addIssue({ code: 'custom', message: 'from and to must be given together' });
      return;
    }
    const from = parseInstant(q.from);
    const to = parseInstant(q.to);
    if (Number.isNaN(from)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must be an ISO-8601 instant' });
    if (Number.isNaN(to)) ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be an ISO-8601 instant' });
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    if (from >= to) ctx.addIssue({ code: 'custom', message: 'from must be before to' });
    else if (to - from > MAX_RANGE_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', message: `the period must not exceed ${MAX_RANGE_DAYS} days` });
    }
  });
export type PeriodQuery = z.infer<typeof PeriodQuery>;

/** The requested period, or the 30 days ending at `now`. Expects a validated query. */
export function resolvePeriod(q: PeriodQuery, now: Date): Period {
  if (q.from === undefined || q.to === undefined) {
    return { from: new Date(now.getTime() - DEFAULT_DAYS * DAY_MS), to: new Date(now.getTime()) };
  }
  return { from: new Date(parseInstant(q.from)), to: new Date(parseInstant(q.to)) };
}

/** Half-open membership: `from <= at < to`. */
export function inPeriod(at: Date, p: Period): boolean {
  return at.getTime() >= p.from.getTime() && at.getTime() < p.to.getTime();
}
