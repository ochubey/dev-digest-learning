/* hooks/project-context.ts — React Query hooks for Project Context (SPEC-02):
   discovery of main-branch markdown docs, previews, and the ordered path lists
   attached to an agent or a skill.

   Writes are optimistic and always carry the FULL ordered list (last write wins,
   AC-24). Writes for one agent/skill share a mutation `scope`, so TanStack runs
   them one at a time in call order; a failed write rolls the cache back and
   toasts (AC-23). */
"use client";

import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type {
  AgentContextAttachments,
  ContextAttachments,
  ContextDiscovery,
  ContextDocPreview,
  DefaultContextRepo,
} from "@devdigest/shared";
import { api } from "../api";
import { notify } from "../toast";

export const contextKeys = {
  defaultRepo: ["context-default-repo"] as const,
  docs: (repoId: string | null | undefined) => ["context-docs", repoId] as const,
  preview: (repoId: string | null | undefined, path: string | null | undefined) =>
    ["context-preview", repoId, path] as const,
  agent: (agentId: string | null | undefined) => ["agent-context", agentId] as const,
  skill: (skillId: string | null | undefined) => ["skill-context", skillId] as const,
};

/** Workspace default repository for the Context tab (`repo_id` is null when none). */
export function useDefaultContextRepo() {
  return useQuery({
    queryKey: contextKeys.defaultRepo,
    queryFn: () => api.get<DefaultContextRepo>("/context/default-repo"),
  });
}

/** Docs at the main branch tip (cached discovery). */
export function useContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.docs(repoId),
    queryFn: () => api.get<ContextDiscovery>(`/repos/${repoId}/context/docs`),
    enabled: !!repoId,
  });
}

/** Re-index: repeat discovery against the current main tip, then replace the cached list. */
export function useReindexContextDocs(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<ContextDiscovery>(`/repos/${repoId}/context/docs?refresh=1`),
    onSuccess: (data) => qc.setQueryData(contextKeys.docs(repoId), data),
  });
}

/** Rendered body of one doc. Never auto-retried: the drawer offers an explicit Retry
    (and a 404, no longer on main, is final). */
export function useContextDocPreview(
  repoId: string | null | undefined,
  path: string | null | undefined,
) {
  return useQuery({
    queryKey: contextKeys.preview(repoId, path),
    queryFn: () =>
      api.get<ContextDocPreview>(
        `/repos/${repoId}/context/docs/preview?path=${encodeURIComponent(path ?? "")}`,
      ),
    enabled: !!repoId && !!path,
    retry: false,
  });
}

export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.agent(agentId),
    queryFn: () => api.get<AgentContextAttachments>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: contextKeys.skill(skillId),
    queryFn: () => api.get<ContextAttachments>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

/** Shared optimistic setter. `mutate(paths)` sends the full ordered list. */
function useSetContext<T extends ContextAttachments>(
  kind: "agent" | "skill",
  id: string | null | undefined,
) {
  const qc = useQueryClient();
  const t = useTranslations("projectContext");
  const key = kind === "agent" ? contextKeys.agent(id) : contextKeys.skill(id);
  const mutationKey = [`${kind}-context-write`, id] as const;
  // Only the last write still in the scope may touch the cache with server data.
  const isLastInFlight = (client: QueryClient) => client.isMutating({ mutationKey }) <= 1;

  return useMutation({
    mutationKey,
    scope: { id: `${kind}-context-${id}` },
    mutationFn: (paths: string[]) => api.put<T>(`/${kind}s/${id}/context`, { paths }),
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<T>(key);
      if (previous) qc.setQueryData<T>(key, { ...previous, paths });
      return { previous };
    },
    onError: (_err, _paths, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      notify.error(t("writeError"));
    },
    onSuccess: (data) => {
      if (isLastInFlight(qc)) qc.setQueryData(key, data);
    },
    onSettled: () => {
      // When the whole queue has drained, re-read the truth (covers rollback chains).
      if (isLastInFlight(qc)) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useSetAgentContext(agentId: string | null | undefined) {
  return useSetContext<AgentContextAttachments>("agent", agentId);
}

export function useSetSkillContext(skillId: string | null | undefined) {
  return useSetContext<ContextAttachments>("skill", skillId);
}
