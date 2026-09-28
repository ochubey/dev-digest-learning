import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Skill, SkillImportPreview } from "@devdigest/shared";

const previewMutateAsync = vi.fn();
const importMutateAsync = vi.fn();

vi.mock("../../../../lib/hooks/skills", () => ({
  useImportSkillPreview: () => ({ mutateAsync: previewMutateAsync, isPending: false, isError: false }),
  useImportSkill: () => ({ mutateAsync: importMutateAsync, isPending: false }),
}));

import { ImportDialog } from "./ImportDialog";

const PREVIEW: SkillImportPreview = {
  name: "pr-quality-rubric",
  description: "Rubric for PR quality",
  type: "rubric",
  body: "# Rubric\n...",
};

const IMPORTED: Skill = {
  id: "sk9",
  name: "pr-quality-rubric",
  description: "Rubric for PR quality",
  type: "rubric",
  source: "imported_file",
  body: "# Rubric\n...",
  enabled: true,
  version: 1,
  agent_count: 0,
};

function makeMdFile(name = "skill.md") {
  return new File(["# Rubric\n..."], name, { type: "text/markdown" });
}

// jsdom's FileReader doesn't implement readAsDataURL meaningfully in some
// environments — stub it deterministically for these tests.
class FakeFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = "data:text/markdown;base64,IyBSdWJyaWM=";
    this.onload?.();
  }
}

beforeEach(() => {
  // @ts-expect-error test stub
  global.FileReader = FakeFileReader;
});

afterEach(() => {
  cleanup();
  previewMutateAsync.mockClear();
  importMutateAsync.mockClear();
});

describe("ImportDialog", () => {
  it("rejects an unsupported file extension with a clear message and never calls preview", async () => {
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const badFile = new File(["zzz"], "skill.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [badFile] } });
    await waitFor(() => {
      expect(screen.getByText(/is not a \.md or \.zip file/)).toBeInTheDocument();
    });
    expect(previewMutateAsync).not.toHaveBeenCalled();
  });

  it("previews a .md file and shows editable fields from the parsed result", async () => {
    previewMutateAsync.mockResolvedValue(PREVIEW);
    render(<ImportDialog onClose={vi.fn()} onImported={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeMdFile()] } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("pr-quality-rubric")).toBeInTheDocument();
    });
    expect(previewMutateAsync).toHaveBeenCalledWith({
      filename: "skill.md",
      contentBase64: "IyBSdWJyaWM=",
    });
  });

  it("confirming the preview calls useImportSkill and reports the imported skill", async () => {
    previewMutateAsync.mockResolvedValue(PREVIEW);
    importMutateAsync.mockResolvedValue(IMPORTED);
    const onImported = vi.fn();
    render(<ImportDialog onClose={vi.fn()} onImported={onImported} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeMdFile()] } });
    await waitFor(() => screen.getByText("Import skill"));
    fireEvent.click(screen.getByText("Import skill"));
    await waitFor(() => {
      expect(importMutateAsync).toHaveBeenCalledWith({
        name: "pr-quality-rubric",
        description: "Rubric for PR quality",
        type: "rubric",
        body: "# Rubric\n...",
      });
    });
    expect(onImported).toHaveBeenCalledWith(IMPORTED);
  });
});
