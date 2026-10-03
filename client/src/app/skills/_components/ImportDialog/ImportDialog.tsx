/* ImportDialog — pick a .md or .zip file, preview the parsed skill
   (editable), then confirm to save. A .zip must contain exactly one root
   .md file (server-validated); anything else is rejected with a clear
   message before/at the network boundary. */
"use client";

import React from "react";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea, ErrorState } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useImportSkillPreview, useImportSkill } from "../../../../lib/hooks/skills";
import { ApiError } from "../../../../lib/api";
import { fileToBase64, isSupportedImportFile } from "./helpers";
import { SKILL_TYPE_OPTIONS } from "./constants";
import { s } from "./styles";

export function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (skill: Skill) => void;
}) {
  const preview = useImportSkillPreview();
  const importSkill = useImportSkill();

  const [fileError, setFileError] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("custom");
  const [body, setBody] = React.useState("");
  const [previewed, setPreviewed] = React.useState(false);

  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setFileError(null);
    if (!isSupportedImportFile(file)) {
      setFileError(`"${file.name}" is not a .md or .zip file — only Markdown skill files (or a .zip containing one) can be imported.`);
      return;
    }
    setFileName(file.name);
    try {
      const content_base64 = await fileToBase64(file);
      const result = await preview.mutateAsync({ filename: file.name, contentBase64: content_base64 });
      setName(result.name);
      setDescription(result.description);
      setType(result.type);
      setBody(result.body);
      setPreviewed(true);
    } catch (e) {
      setFileError(e instanceof ApiError ? e.message : "Could not parse this file.");
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const confirm = async () => {
    const skill = await importSkill.mutateAsync({ name, description, type, body });
    onImported(skill);
  };

  return (
    <Modal width={640} title="Import skill from file" subtitle="Only .md files are supported" onClose={onClose}>
      <div style={s.body}>
        {!previewed && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".md,.zip"
              style={{ display: "none" }}
              onChange={onFileInput}
            />
            <div
              style={s.dropzone(dragOver)}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {preview.isPending ? "Parsing…" : "Click to choose a .md or .zip file, or drag it here"}
              </div>
              <div style={s.hint}>
                A Markdown file (.md), or a .zip containing exactly one .md file at its root.
              </div>
            </div>
            {fileError && (
              <div style={s.error}>
                {fileError}
              </div>
            )}
            {preview.isError && !fileError && (
              <ErrorState body="Could not parse this file." />
            )}
          </>
        )}

        {previewed && (
          <>
            {fileName && <div style={s.fileName}>{fileName}</div>}
            <FormField label="Name" required>
              <TextInput value={name} onChange={setName} />
            </FormField>
            <FormField label="Description">
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <FormField label="Type">
              <SelectInput value={type} onChange={(v) => setType(v as SkillType)} options={SKILL_TYPE_OPTIONS} />
            </FormField>
            <FormField label="Body (Markdown)">
              <Textarea value={body} onChange={setBody} rows={12} mono />
            </FormField>
          </>
        )}

        <div style={{ ...s.footer, marginTop: 20 }}>
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          {previewed && (
            <Button
              kind="primary"
              icon="Upload"
              onClick={confirm}
              disabled={importSkill.isPending || !name.trim() || !body.trim()}
            >
              {importSkill.isPending ? "Importing…" : "Import skill"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
