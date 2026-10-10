"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge, Button, EmptyState, Skeleton, TextInput } from "@devdigest/ui";
import {
  useAgentContext,
  useContextDocs,
  useReindexContextDocs,
  useSetAgentContext,
  useSetSkillContext,
  useSkillContext,
} from "@/lib/hooks/project-context";
import { MAX_ATTACHED } from "../constants";
import { ContextDocRow } from "../ContextDocRow";
import { ContextFooter } from "../ContextFooter";
import { ContextDocPreviewDrawer } from "../ContextDocPreviewDrawer";
import { buildRows, filterRows, footerTotals, moveItem, reorderOnDrop } from "../helpers";
import { s } from "./styles";

export interface ContextDocPickerProps {
  /** Discovery repository; null shows the empty state with Re-index disabled. */
  repoId: string | null;
  /** Whose ordered list is edited. Skills have no inherited rows. */
  owner: { kind: "agent" | "skill"; id: string };
  /** Hide the "X of Y attached" header badge (the skill tab renders its own "N attached"). */
  hideSummary?: boolean;
}

/**
 * The document picker: filter, Re-index, sortable rows, footer and the preview
 * drawer. Every attach / detach / reorder persists the FULL list immediately
 * (optimistic, rolled back on failure) through the owner's context hook.
 */
export function ContextDocPicker({ repoId, owner, hideSummary }: ContextDocPickerProps) {
  const t = useTranslations("projectContext");
  const [filter, setFilter] = React.useState("");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  const isAgent = owner.kind === "agent";

  const docsQ = useContextDocs(repoId);
  const reindex = useReindexContextDocs(repoId);
  const agentQ = useAgentContext(isAgent ? owner.id : null);
  const skillQ = useSkillContext(isAgent ? null : owner.id);
  const setAgent = useSetAgentContext(isAgent ? owner.id : null);
  const setSkill = useSetSkillContext(isAgent ? null : owner.id);
  const writer = isAgent ? setAgent : setSkill;
  const ownerQ = isAgent ? agentQ : skillQ;

  const attached = ownerQ.data?.paths ?? [];
  const inherited = isAgent ? (agentQ.data?.inherited ?? []) : [];
  const docs = docsQ.data?.docs;
  const discoveryFailed = !!repoId && docsQ.isError && !docsQ.data;
  const loading = !!repoId && (docsQ.isPending || ownerQ.isPending) && !discoveryFailed;

  const rows = React.useMemo(
    () => buildRows(discoveryFailed ? undefined : docs, attached, inherited),
    [docs, discoveryFailed, attached, inherited],
  );
  const visible = filterRows(rows, filter);
  const totals = footerTotals(rows);
  const attachedFound = docs ? attached.filter((p) => docs.some((d) => d.path === p)).length : 0;
  const noDocs = !!docs && docs.length === 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const save = (next: string[]) => writer.mutate(next);
  const atLimit = attached.length >= MAX_ATTACHED;
  const toggle = (path: string) => {
    if (attached.includes(path)) return save(attached.filter((p) => p !== path));
    if (!atLimit) save([...attached, path]);
  };
  const move = (path: string, delta: -1 | 1) => {
    const from = attached.indexOf(path);
    save(moveItem(attached, from, from + delta));
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const next = reorderOnDrop(attached, String(e.active.id), e.over ? String(e.over.id) : null);
    if (next) save(next);
  };

  // Synchronous guard: a fast double click must not send two discovery requests.
  const reindexing = React.useRef(false);
  const runReindex = () => {
    if (reindexing.current || !repoId) return;
    reindexing.current = true;
    reindex.mutate(undefined, { onSettled: () => (reindexing.current = false) });
  };

  const reindexButton = (
    <Button
      size="sm"
      icon="RefreshCw"
      disabled={!repoId || reindex.isPending}
      loading={reindex.isPending}
      onClick={runReindex}
    >
      {reindex.isPending ? t("reindex.busy") : t("reindex.label")}
    </Button>
  );

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        {!hideSummary && (
          <Badge>
            {docs
              ? t("summary.attachedOf", { attached: attachedFound, total: docs.length })
              : t("summary.attached", { count: attached.length })}
          </Badge>
        )}
        <div style={s.filter}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("filter.placeholder")}
            aria-label={t("filter.label")}
          />
        </div>
        {reindexButton}
      </div>

      {discoveryFailed && (
        <div role="alert" style={s.errorBox}>
          <div style={s.errorText}>
            <span style={s.errorTitle}>{t("error.title")}</span>
            <span>{t("error.body")}</span>
          </div>
          <Button size="sm" icon="RefreshCw" onClick={() => void docsQ.refetch()}>
            {t("error.retry")}
          </Button>
        </div>
      )}

      {atLimit && (
        <div role="status" style={s.limitNote}>
          {t("limit.reached", { max: MAX_ATTACHED })}
        </div>
      )}

      {writer.isError && (
        <div role="alert" style={s.writeError}>
          {t("writeError")}
        </div>
      )}

      {loading ? (
        <div role="status" aria-label={t("loading")} style={s.skeletons}>
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      ) : (
        <>
          {visible.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={visible.map((r) => r.key)} strategy={verticalListSortingStrategy}>
                <div style={s.list}>
                  {visible.map((row) => {
                    const idx = attached.indexOf(row.path);
                    return (
                      <ContextDocRow
                        key={row.key}
                        row={row}
                        canMoveUp={idx > 0}
                        canMoveDown={idx >= 0 && idx < attached.length - 1}
                        attachDisabled={atLimit && !row.attached}
                        onToggle={toggle}
                        onMove={move}
                        onPreview={setPreviewPath}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {!repoId ? (
            <EmptyState icon="FileText" title={t("empty.title")} body={t("noRepo")} />
          ) : noDocs ? (
            <EmptyState
              icon="FileText"
              title={t("empty.title")}
              body={t("empty.body")}
              cta={t("reindex.label")}
              onCta={runReindex}
              ctaLoading={reindex.isPending}
            />
          ) : docs && visible.length === 0 && filter.trim() ? (
            <div style={s.block}>
              <span>{t("noMatch.title", { text: filter.trim() })}</span>
              <Button size="sm" kind="ghost" onClick={() => setFilter("")}>
                {t("noMatch.clear")}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ContextFooter {...totals} />

      {previewPath && repoId && (
        <ContextDocPreviewDrawer
          repoId={repoId}
          path={previewPath}
          attached={attached.includes(previewPath)}
          attachDisabled={atLimit && !attached.includes(previewPath)}
          onToggleAttach={() => toggle(previewPath)}
          onClose={() => setPreviewPath(null)}
          returnFocus={() =>
            document.querySelector<HTMLElement>(
              `[data-testid="context-doc-preview"][data-path="${CSS.escape(previewPath)}"]`,
            )
          }
        />
      )}
    </div>
  );
}
