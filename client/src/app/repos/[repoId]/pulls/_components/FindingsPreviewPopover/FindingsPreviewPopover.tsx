/* FindingsPreviewPopover — the PR-list "FINDINGS" column trigger + hover
   popover. Read-only: severity icon + title + category + file:line +
   confidence% only, no Accept/Reject (those live on the PR detail page's
   ReviewRunAccordion cards, per the read-only-preview-vs-actionable-card
   split). */
import { Icon, SEV } from "@devdigest/ui";
import { Popover } from "@/components/popover";
import type { FindingPreview } from "@/lib/types";

const SEVERITY_ORDER: FindingPreview["severity"][] = ["CRITICAL", "WARNING", "SUGGESTION"];

export function FindingsPreviewPopover({
  findings,
}: {
  findings: { severity_counts: Record<FindingPreview["severity"], number>; items: FindingPreview[] } | null | undefined;
}) {
  if (!findings || findings.items.length === 0) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }
  const total = findings.items.length;
  const presentSeverities = SEVERITY_ORDER.filter((sev) => findings.severity_counts[sev] > 0);

  return (
    <Popover
      trigger={
        <div style={{ display: "flex", alignItems: "center", gap: 4, cursor: "default" }}>
          {presentSeverities.map((sev) => {
            const s = SEV[sev];
            const I = Icon[s.icon];
            return (
              <span key={sev} style={{ display: "inline-flex", alignItems: "center", gap: 2, color: s.c }}>
                <I size={13} />
                <span className="tnum" style={{ fontSize: 12, fontWeight: 600 }}>
                  {findings.severity_counts[sev]}
                </span>
              </span>
            );
          })}
        </div>
      }
      width={340}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", color: "var(--text-muted)", marginBottom: 8 }}>
        {total} FINDING{total === 1 ? "" : "S"} IN THIS RUN
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
        {findings.items.map((f, i) => {
          const s = SEV[f.severity];
          const I = Icon[s.icon];
          return (
            <div key={i} style={{ fontSize: 12.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <I size={12.5} style={{ color: s.c, flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{f.title}</span>
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 2 }}>
                {f.category} · <span className="mono">{f.file}:{f.start_line}</span> ·{" "}
                <span className="tnum">{Math.round(f.confidence * 100)}%</span> conf
              </div>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
