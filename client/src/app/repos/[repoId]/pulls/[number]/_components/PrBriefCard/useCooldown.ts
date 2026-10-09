"use client";

import { useEffect, useReducer } from "react";
import { useBriefCooldownEnd } from "@/lib/hooks/brief";

/** Whole seconds left of the shared generation cooldown for this PR (0 = none), re-rendering once
 *  per second while it runs. The end timestamp lives in the query cache, so a remount keeps it. */
export function useCooldown(prId: string | null | undefined): number {
  const end = useBriefCooldownEnd(prId);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  const active = remaining > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [active, end]);
  return remaining;
}
