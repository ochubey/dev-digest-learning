/* AgentPickCard — one agent as a labelled native checkbox card. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { agentAccent } from "./helpers";
import { s } from "./styles";

export function AgentPickCard({
  agent,
  checked,
  disabled,
  estimate,
  disabledLabel,
  onChange,
}: {
  agent: Pick<Agent, "id" | "name" | "model" | "enabled"> & { description?: string | null };
  checked: boolean;
  /** Unchecked box at the agent limit. */
  disabled: boolean;
  /** Already-formatted estimate text (or the "no history" text). */
  estimate: string;
  disabledLabel: string;
  onChange: (checked: boolean) => void;
}) {
  const accent = agentAccent(agent.id || agent.name);
  return (
    <label style={s.card(checked, disabled, accent)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={s.cardIcon(accent)} data-testid="agent-icon" aria-hidden>
        <Icon.Cpu size={16} />
      </span>
      <span style={s.cardBody}>
        <span style={s.cardName}>{agent.name}</span>
        {agent.description && <span style={s.cardDescription}>{agent.description}</span>}
        <span className="mono" style={{ ...s.cardMeta, display: "block" }}>
          {agent.enabled ? agent.model : `${agent.model} · ${disabledLabel}`}
        </span>
      </span>
      <span style={s.cardEstimate}>{estimate}</span>
    </label>
  );
}
