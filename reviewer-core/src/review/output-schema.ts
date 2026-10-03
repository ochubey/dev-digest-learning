import { z } from 'zod';
import { Finding, Review } from '@devdigest/shared';

/**
 * Model-facing output schema: the shared Review contract plus the per-finding
 * scope classification the model emits. Scope policy itself is code-owned; the
 * model only labels. An invalid scope value parses to null (never throws), so
 * a bad label costs no reprompt / extra LLM call. scope_reason is unbounded.
 */
export const ModelFinding = Finding.extend({
  // Re-declared (not inherited from the shared Finding) ONLY to add `.catch(null)`:
  // the shared contract's `scope` rejects unknown values, which would fail the whole
  // structured response and trigger a reprompt. The enum values MUST stay equal to the
  // shared Finding scope enum (asserted in test/output-schema.test.ts).
  scope: z.enum(['in', 'out', 'signal']).nullish().catch(null),
  scope_reason: z.string().nullish().catch(null),
});
export type ModelFinding = z.infer<typeof ModelFinding>;

export const ModelReview = Review.extend({
  findings: z.array(ModelFinding),
});
export type ModelReview = z.infer<typeof ModelReview>;
/** Parsed (output) shape of ModelReview; the `.catch()` makes its z.input `unknown`. */
export type ModelReviewOut = z.output<typeof ModelReview>;

/**
 * `ModelReview` typed for `LLMProvider.completeStructured<ModelReviewOut>`, whose
 * `StructuredRequest.schema` is `ZodType<T>` (input === output). `.catch()` widens
 * ONLY the phantom input type to `unknown`; providers just parse unknown JSON, so
 * the output type is exact. One single-step, centralised assertion (no
 * `as unknown as`); removing it needs `StructuredRequest<T, I>` in the shared
 * contract (read-only here).
 */
export const ModelReviewSchema = ModelReview as z.ZodType<ModelReviewOut>;
