import type { FindingActionKind } from '@devdigest/shared';
import { AppError, NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { findingRowToDto, type ReviewDtoFinding } from './helpers.js';

/**
 * Finding actions available in the starter: accept / dismiss / learn. These decisions
 * are the dataset later lessons build on (eval cases from accept/dismiss, the
 * `learn → memory` action, etc.).
 */
export async function actOnFinding(
  repo: ReviewRepository,
  workspaceId: string,
  findingId: string,
  action: FindingActionKind,
): Promise<{ finding: ReviewDtoFinding }> {
  const ctx = await repo.findingContext(findingId);
  if (!ctx || ctx.pull.workspaceId !== workspaceId) {
    throw new NotFoundError('Finding not found');
  }

  switch (action) {
    case 'accept': {
      const row = await repo.setFindingAccepted(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'dismiss': {
      const row = await repo.setFindingDismissed(findingId, new Date());
      return { finding: findingRowToDto(row!) };
    }
    case 'learn': {
      // No LLM, no embedding: a rule-like text built from the finding. Idempotent per finding.
      const existing = await repo.findLearnedMemoryId(workspaceId, findingId);
      if (!existing) {
        await repo.insertLearnedMemory({
          workspaceId,
          repoId: ctx.pull.repoId,
          content: learningText(ctx.finding),
          confidence: ctx.finding.confidence,
          sources: [{ finding_id: findingId, review_id: ctx.review.id, pr_id: ctx.pull.id }],
        });
      }
      return { finding: findingRowToDto(ctx.finding) };
    }
    default:
      throw new AppError('invalid_action', `Action '${action}' is not available in the starter`, 400);
  }
}

const LEARNING_MAX_CHARS = 600;

/** "<title>. <rationale> Fix: <suggestion>" as one short rule-like text. */
export function learningText(f: { title: string; rationale: string; suggestion: string | null }): string {
  const end = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const parts = [end(f.title.trim()), end(f.rationale.trim())];
  if (f.suggestion?.trim()) parts.push(`Fix: ${end(f.suggestion.trim())}`);
  const text = parts.filter((p) => p !== '.').join(' ');
  return text.length > LEARNING_MAX_CHARS ? `${text.slice(0, LEARNING_MAX_CHARS - 1)}…` : text;
}
