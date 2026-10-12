import type { EvalCaseDraft } from "@devdigest/shared";

/** The owner agent used for the case: the draft's own agent, else the one the user picked. */
export function effectiveAgentId(draft: Pick<EvalCaseDraft, "agent_id">, picked: string): string {
  return draft.agent_id ?? picked;
}

/** AC-10: the id of an existing case created from this finding for `agentId`, if any. */
export function existingCaseId(draft: Pick<EvalCaseDraft, "existing_cases">, agentId: string): string | null {
  if (!agentId) return null;
  return draft.existing_cases.find((c) => c.agent_id === agentId)?.case_id ?? null;
}

/** Deep link to an agent's Evals tab. */
export function evalsTabHref(agentId: string): string {
  return `/agents/${encodeURIComponent(agentId)}?tab=evals`;
}

export function formatRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}–${end}`;
}
