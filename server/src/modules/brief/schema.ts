import { z } from 'zod';
import { PrBrief, Risk, RiskSeverity } from '@devdigest/shared';
import { RISK_KINDS } from './constants.js';

/**
 * What the model returns. Strict-mode safe: no `.max()`, `.min()` or `.optional()` (lengths
 * are clamped in code), no `line_adjusted` (grounding alone sets it).
 */
export const BriefModelOutput = z.object({
  summary: z.string(),
  risks: z.array(
    z.object({
      kind: z.enum(RISK_KINDS),
      title: z.string(),
      explanation: z.string(),
      severity: RiskSeverity,
      file_refs: z.array(z.string()),
    }),
  ),
  review_focus: z.array(
    z.object({
      file: z.string(),
      line: z.number().int(),
      reason: z.string(),
    }),
  ),
});
export type BriefModelOutput = z.infer<typeof BriefModelOutput>;

/**
 * Server-only: validated before every write. Every stored risk keeps >= 1 grounded ref; the
 * shared `Risk` stays permissive.
 */
export const PrBriefStored = PrBrief.extend({
  risks: z.object({
    risks: z.array(Risk.extend({ file_refs: z.array(z.string()).min(1) })),
  }),
});
export type PrBriefStored = z.infer<typeof PrBriefStored>;
