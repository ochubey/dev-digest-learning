"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentBlock } from "../IntentBlock";
import { BlastRadiusBlock } from "../BlastRadiusBlock";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string;
  prBody: string | null | undefined;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function OverviewTab({ prId, prBody, repoFullName, headSha }: OverviewTabProps) {
  return (
    <>
      <IntentBlock prId={prId} />
      <BlastRadiusBlock prId={prId} repoFullName={repoFullName} headSha={headSha} />
      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
