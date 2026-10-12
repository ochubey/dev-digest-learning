"use client";

import React from "react";
import { Skeleton } from "@devdigest/ui";
import { s } from "./styles";

/** First-generation placeholder: summary column and risks / focus column. */
export function BriefSkeleton() {
  return (
    <div data-testid="brief-skeleton" aria-hidden="true" style={s.skeletonGrid}>
      <div style={s.loadingWrap}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="100%" height={14} />
        <Skeleton width="90%" height={14} />
      </div>
      <div style={s.loadingWrap}>
        <Skeleton width="100%" height={32} />
        <Skeleton width="100%" height={32} />
        <Skeleton width="80%" height={14} />
      </div>
    </div>
  );
}
