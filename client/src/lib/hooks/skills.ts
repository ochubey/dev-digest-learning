/* hooks/skills.ts — React Query hooks for workspace Skills + agent<->skill links
   (Skills tab of the Agent Editor). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Skill,
  AgentSkillLink,
  SkillVersion,
  SkillImportPreview,
} from "@devdigest/shared";

/** All workspace skills (for the toggle-list of what CAN be linked to an agent).
    Backed by `GET /skills`, landing in parallel with this task — build against
    the documented contract regardless. */
export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

/** Skills currently linked to an agent, in prompt-assembly order. Server
    returns AgentSkillLink[] ({agent_id, skill_id, order}), not full Skill
    objects — callers cross-reference `skill_id` against useSkills()'s list. */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

export interface SetAgentSkillsInput {
  agentId: string;
  skillIds: string[];
}

/** Full replace + reorder of an agent's linked skills — order = array index.
    This is what both the checkbox toggle and the reorder control call. */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: SetAgentSkillsInput) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });
}

/* ---------------------------------------------------------------------- *
 * Below: hooks for the standalone Skills Lab page (`/skills`). Added on
 * top of the agent-linking hooks above without touching their signatures.
 * ---------------------------------------------------------------------- */

/** A single skill, by id. Backed by `GET /skills/:id`. */
export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skills", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: Skill["type"];
  body: string;
  enabled?: boolean;
}

/** `POST /skills` — create a new skill (source defaults to `manual` server-side). */
export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: {
    name?: string;
    description?: string;
    type?: Skill["type"];
    body?: string;
  };
}

/** `PUT /skills/:id` — update name/description/type/body. Server bumps `version`. */
export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (skill) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skills", skill.id] });
      qc.invalidateQueries({ queryKey: ["skills", skill.id, "versions"] });
    },
  });
}

export interface SetSkillEnabledInput {
  id: string;
  enabled: boolean;
}

/** `PATCH /skills/:id/enabled` — toggle only, no version bump. */
export function useSetSkillEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: SetSkillEnabledInput) =>
      api.patch<Skill>(`/skills/${id}/enabled`, { enabled }),
    onSuccess: (skill) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skills", skill.id] });
    },
  });
}

/** `DELETE /skills/:id` — hard delete (agent_skills cascades server-side). */
export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/skills/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

/** `GET /skills/:id/versions` — version history, newest first, read-only. */
export function useSkillVersions(id: string | null | undefined) {
  return useQuery({
    queryKey: ["skills", id, "versions"],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export interface ImportSkillPreviewInput {
  filename: string;
  contentBase64: string;
}

/** `POST /skills/import/preview` — parses an uploaded `.md` file, never
    writes to the DB. Not a mutation of persisted state, but modeled as one
    (no natural cache key) since it has a side-effecting network call. */
export function useImportSkillPreview() {
  return useMutation({
    mutationFn: ({ filename, contentBase64 }: ImportSkillPreviewInput) =>
      api.post<SkillImportPreview>("/skills/import/preview", {
        filename,
        content_base64: contentBase64,
      }),
  });
}

export interface ImportSkillInput {
  name: string;
  description: string;
  type: Skill["type"];
  body: string;
}

/** `POST /skills/import` — writes the (possibly edited) preview payload.
    Server sets `source: 'imported_file'` automatically. */
export function useImportSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportSkillInput) => api.post<Skill>("/skills/import", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export interface RestoreSkillVersionInput {
  id: string;
  version: number;
}

/** `POST /skills/:id/versions/:version/restore` — restores `skills.body` to
    that version's snapshot, snapshotting the pre-restore body first and
    bumping `version`. */
export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: RestoreSkillVersionInput) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`, {}),
    onSuccess: (skill) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skills", skill.id] });
      qc.invalidateQueries({ queryKey: ["skills", skill.id, "versions"] });
    },
  });
}
