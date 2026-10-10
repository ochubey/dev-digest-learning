/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { PROJECT_CONTEXT_SOFT_CAP_TOKENS } from "@devdigest/shared";
import type { RunTrace, FindingRecord } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import {
  formatSeconds,
  formatTokens,
  formatSkillTokens,
  normalizeSpecsRead,
  projectContextEntries,
  specsTokenSummary,
} from "../../helpers";
import { formatCost } from "@/components/run-cost-badge";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  const specRows = normalizeSpecsRead(trace.specs_read);
  const specsSummary = specsTokenSummary(specRows, trace.project_context);
  const pcEntries = projectContextEntries(trace);
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          {trace.prompt_assembly.skills_meta != null && trace.prompt_assembly.skills_meta.length > 0 && (
            <Row label={t("trace.config.skillsLoaded")}>
              <div style={s.specsWrap}>
                {trace.prompt_assembly.skills_meta.map((sk) => (
                  <Badge key={sk.skill_id} color="var(--accent-text)" bg="var(--bg-hover)">
                    {sk.name}
                    <span style={{ opacity: 0.7 }}>{`+${formatSkillTokens(sk.tokens)} tok`}</span>
                  </Badge>
                ))}
              </div>
            </Row>
          )}
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsCol}>
              <div style={s.specsWrap}>
                {specRows.length === 0 ? (
                  <span style={s.specsNone}>{t("trace.config.none")}</span>
                ) : (
                  specRows.map((sp, i) =>
                    sp.status === "skipped" ? (
                      <span key={i} data-testid="spec-skipped" style={s.specsWrap}>
                        <span className="mono" style={s.specSkipped}>
                          {sp.path}
                        </span>
                        <span style={s.specSkipReason}>
                          {t("trace.config.specSkipped", { reason: sp.reason ? t(`trace.config.specReason.${sp.reason}`) : "?" })}
                        </span>
                      </span>
                    ) : (
                      <span key={i} className="mono" style={s.spec}>
                        {sp.tokens == null ? sp.path : t("trace.config.specTokens", { path: sp.path, tokens: sp.tokens })}
                      </span>
                    ),
                  )
                )}
              </div>
              {specsSummary.softCapExceeded && (
                <span data-testid="spec-soft-cap" style={s.specsNote}>
                  {t("trace.config.specsSoftCap", { tokens: specsSummary.tokens, cap: PROJECT_CONTEXT_SOFT_CAP_TOKENS })}
                </span>
              )}
            </div>
          </Row>
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          <Stat label={t("trace.stat.cost")} val={formatCost(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock label={t("trace.prompt.skills")} text={trace.prompt_assembly.skills} color={PROMPT_COLORS.skills} />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {pcEntries.length > 0 && pcEntries[0]!.path !== null && (
          <div style={s.promptSectionLabel}>{t("trace.prompt.projectContext")}</div>
        )}
        {pcEntries.map((e, i) => (
          <PromptBlock
            key={e.path ?? `legacy-${i}`}
            label={
              e.path === null
                ? t("trace.prompt.specs")
                : t("trace.config.specTokens", { path: e.path, tokens: e.tokens ?? 0 })
            }
            text={e.text}
            color={PROMPT_COLORS.specs}
          />
        ))}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
