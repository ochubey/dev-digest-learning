/* hooks/conventions.ts — React Query hooks for the Conventions feature
   (per-repo extraction → review → fold into a skill). Mirrors hooks/skills.ts:
   same api.get/post/patch wrapper style, query key shape, invalidate-on-success. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

/** All candidates for a repo (any status) — backed by `GET /repos/:id/conventions`. */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

/** `POST /repos/:id/conventions/extract` — runs (or re-runs) the extraction
    pipeline; used for both "Run Scan" and "ReScan". */
export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface PatchConventionInput {
  repoId: string;
  id: string;
  action: "accept" | "reject" | "edit";
  rule?: string;
  category?: string;
  evidence_path?: string;
  evidence_snippet?: string;
}

/** `PATCH /conventions/:id` — accept | reject | edit. */
export function usePatchConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, repoId: _repoId, ...body }: PatchConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, body),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface CreateSkillFromConventionsInput {
  repoId: string;
  name?: string;
  description: string;
  candidateIds: string[];
  /** Editable skill body from the create-skill modal (rubric #41). */
  body?: string;
}

/** `POST /repos/:id/conventions/create-skill` — folds accepted candidates
    into a new skill. Invalidates both conventions (rule: none actually
    change status server-side, but keeps parity) and `["skills"]` so the new
    skill shows up on `/skills` for free (rubric #52). */
export function useCreateSkillFromConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, name, description, candidateIds, body }: CreateSkillFromConventionsInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/create-skill`, {
        name,
        description,
        candidate_ids: candidateIds,
        body,
      }),
    onSuccess: (_data, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}
