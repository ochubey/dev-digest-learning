/* ConventionCard — rule text, evidence file(+line), confidence %, and
   Accept/Reject/Edit actions. Edit is INLINE: swaps the display for an
   editable form in place, no modal, no route change (rubric #49). */
"use client";

import React from "react";
import { Button, Badge, Textarea, TextInput } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { usePatchConvention } from "../../../../../../lib/hooks/conventions";
import { s } from "./styles";

export function ConventionCard({
  candidate,
  repoId,
}: {
  candidate: ConventionCandidate;
  repoId: string;
}) {
  const patch = usePatchConvention();
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState(candidate.category ?? "");
  const [evidencePath, setEvidencePath] = React.useState(candidate.evidence_path ?? "");
  const [evidenceSnippet, setEvidenceSnippet] = React.useState(candidate.evidence_snippet ?? "");

  const confidencePct = candidate.confidence != null ? Math.round(candidate.confidence * 100) : null;
  const evidenceLabel = candidate.evidence_path
    ? candidate.evidence_line != null
      ? `${candidate.evidence_path}:${candidate.evidence_line}`
      : candidate.evidence_path
    : null;

  const saveEdit = () => {
    patch.mutate(
      {
        repoId,
        id: candidate.id,
        action: "edit",
        rule,
        category,
        evidence_path: evidencePath,
        evidence_snippet: evidenceSnippet,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  if (editing) {
    return (
      <div style={s.card}>
        <div style={s.editForm}>
          <Textarea value={rule} onChange={setRule} rows={3} placeholder="Rule text" />
          <TextInput value={category} onChange={setCategory} placeholder="Category" />
          <TextInput value={evidencePath} onChange={setEvidencePath} placeholder="Evidence file path" />
          <TextInput value={evidenceSnippet} onChange={setEvidenceSnippet} placeholder="Evidence snippet / category" />
        </div>
        <div style={s.actionsRow}>
          <div style={s.spacer} />
          <Button kind="ghost" onClick={() => setEditing(false)} disabled={patch.isPending}>
            Cancel
          </Button>
          <Button kind="primary" onClick={saveEdit} disabled={patch.isPending || !rule.trim()}>
            {patch.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.rule}>{candidate.rule}</div>
      <div style={s.metaRow}>
        {candidate.category && (
          <Badge color="var(--accent)" bg="var(--accent-bg)">
            {candidate.category}
          </Badge>
        )}
        {evidenceLabel && (
          <Badge color="var(--text-muted)" icon="FileText" mono>
            {evidenceLabel}
          </Badge>
        )}
        {confidencePct != null && (
          <Badge color="var(--text-secondary)">{confidencePct}% confidence</Badge>
        )}
        {candidate.accepted && <Badge color="var(--good)">Accepted</Badge>}
      </div>
      <div style={s.actionsRow}>
        <div style={s.spacer} />
        <Button kind="ghost" icon="Edit" onClick={() => setEditing(true)} disabled={patch.isPending}>
          Edit
        </Button>
        <Button
          kind="ghost"
          icon="X"
          onClick={() => patch.mutate({ repoId, id: candidate.id, action: "reject" })}
          disabled={patch.isPending}
        >
          Reject
        </Button>
        <Button
          kind={candidate.accepted ? "secondary" : "primary"}
          icon="Check"
          onClick={() => patch.mutate({ repoId, id: candidate.id, action: "accept" })}
          disabled={patch.isPending || candidate.accepted}
        >
          {candidate.accepted ? "Accepted" : "Accept"}
        </Button>
      </div>
    </div>
  );
}
