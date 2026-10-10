"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SelectInput } from "@devdigest/ui";
import type { Repo } from "@devdigest/shared";
import { s } from "./styles";

export interface ContextRepoPickerProps {
  repos: Repo[];
  /** Selected repository id; null when none resolved. */
  value: string | null;
  onChange: (repoId: string) => void;
}

/** Select of the workspace repos; renders nothing when there are none. */
export function ContextRepoPicker({ repos, value, onChange }: ContextRepoPickerProps) {
  const t = useTranslations("agents");
  if (repos.length === 0) return null;
  const options = [
    ...(value ? [] : [{ value: "", label: t("context.repoPlaceholder") }]),
    ...repos.map((r) => ({ value: r.id, label: r.full_name })),
  ];
  return (
    <label style={s.wrap}>
      <span style={s.label}>{t("context.repoLabel")}</span>
      <SelectInput
        value={value ?? ""}
        onChange={(v) => v && onChange(v)}
        options={options}
        mono={false}
      />
    </label>
  );
}
