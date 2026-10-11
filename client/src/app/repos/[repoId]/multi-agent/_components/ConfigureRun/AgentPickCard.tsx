/* AgentPickCard — one agent as a labelled native checkbox card. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";
import { s } from "./styles";

export function AgentPickCard({
  agent,
  checked,
  disabled,
  estimate,
  disabledLabel,
  onChange,
}: {
  agent: Pick<Agent, "id" | "name" | "model" | "enabled">;
  checked: boolean;
  /** Unchecked box at the agent limit. */
  disabled: boolean;
  /** Already-formatted estimate text (or the "no history" text). */
  estimate: string;
  disabledLabel: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={s.card(checked, disabled)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={s.cardBody}>
        <span style={s.cardName}>{agent.name}</span>
        <br />
        <span className="mono" style={s.cardMeta}>
          {agent.enabled ? agent.model : `${agent.model} · ${disabledLabel}`}
        </span>
      </span>
      <span style={s.cardEstimate}>{estimate}</span>
    </label>
  );
}
