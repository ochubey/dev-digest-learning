"use client";

import React from "react";
import { useDefaultContextRepo } from "@/lib/hooks/project-context";
import { useRepos } from "@/lib/hooks/core";
import { REPO_STORAGE_KEY } from "./constants";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(REPO_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The discovery repository for a Context tab: the remembered choice (if it is
 * still a workspace repo), else the workspace default, else null (no repos).
 */
export function useContextRepo() {
  const reposQ = useRepos();
  const defaultQ = useDefaultContextRepo();
  const [chosen, setChosen] = React.useState<string | null>(null);

  // Read storage after mount so server and client markup match.
  React.useEffect(() => setChosen(readStored()), []);

  const repos = reposQ.data ?? [];
  const known = (id: string | null | undefined): id is string => !!id && repos.some((r) => r.id === id);
  const repoId = known(chosen) ? chosen : known(defaultQ.data?.repo_id) ? defaultQ.data.repo_id : null;

  const select = React.useCallback((id: string) => {
    setChosen(id);
    try {
      window.localStorage.setItem(REPO_STORAGE_KEY, id);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
  }, []);

  return { repos, repoId, select };
}
