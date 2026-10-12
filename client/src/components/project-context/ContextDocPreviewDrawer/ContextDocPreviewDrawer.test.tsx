import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocPreview, ContextDoc } from "@devdigest/shared";
import messages from "../../../../messages/en/projectContext.json";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => get(...a),
      put: (...a: unknown[]) => put(...a),
    },
  };
});

import { ApiError } from "@/lib/api";
import { ContextDocPreviewDrawer } from "./ContextDocPreviewDrawer";
import { ContextDocPicker } from "../ContextDocPicker";

const PATH = "specs/security-baseline.md";
const preview = (over: Partial<ContextDocPreview> = {}): ContextDocPreview => ({
  path: PATH,
  source: "specs",
  tokens: 1234,
  used_by: 1,
  content: "# Security baseline\n\nNo secrets in code.",
  commit_sha: "abc",
  ...over,
});

let qc: QueryClient;
function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>
  );
}

function renderDrawer(over: Partial<React.ComponentProps<typeof ContextDocPreviewDrawer>> = {}) {
  const onClose = vi.fn();
  const onToggleAttach = vi.fn();
  const utils = render(
    wrap(
      <ContextDocPreviewDrawer
        repoId="r1"
        path={PATH}
        attached={false}
        onToggleAttach={onToggleAttach}
        onClose={onClose}
        {...over}
      />,
    ),
  );
  return { onClose, onToggleAttach, ...utils };
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(cleanup);

describe("ContextDocPreviewDrawer", () => {
  it("title path, source badge, \"Used by 1 agent\" / \"Used by 3 agents\", token label, rendered heading", async () => {
    get.mockResolvedValue(preview());
    const { unmount } = renderDrawer();
    expect(get).toHaveBeenCalledWith(
      `/repos/r1/context/docs/preview?path=${encodeURIComponent(PATH)}`,
    );
    expect(await screen.findByRole("heading", { name: "Security baseline" })).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(PATH);
    expect(screen.getByTestId("context-preview-source")).toHaveTextContent("specs");
    expect(screen.getByText("Used by 1 agent")).toBeInTheDocument();
    expect(screen.getByText("1.2K tokens")).toBeInTheDocument();
    unmount();
    qc.clear();
    get.mockResolvedValue(preview({ used_by: 3 }));
    renderDrawer();
    expect(await screen.findByText("Used by 3 agents")).toBeInTheDocument();
  });

  it("<script> and <img onerror> not in DOM; no edit control", async () => {
    get.mockResolvedValue(
      preview({
        content:
          "# Hi\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror=\"window.__pwned=2\">\n\ntext",
      }),
    );
    renderDrawer();
    await screen.findByRole("heading", { name: "Hi" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("script")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog.querySelector("[onerror]")).toBeNull();
    expect(dialog.querySelector("textarea, input[type='text'], [contenteditable='true']")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("Attach/Attached toggles row checkbox and footer", async () => {
    const docs: ContextDoc[] = [
      { path: PATH, name: "security-baseline.md", folder: "specs", source: "specs", tokens: 400 },
    ];
    const server = { paths: [] as string[] };
    get.mockImplementation(async (url: string) => {
      if (url === "/repos/r1/context/docs")
        return { repo_id: "r1", branch: "main", commit_sha: "abc", docs };
      if (url === "/agents/ag1/context") return { paths: server.paths, version: 1, inherited: [] };
      return preview({ tokens: 400 });
    });
    put.mockImplementation(async (_u: string, body: { paths: string[] }) => {
      server.paths = body.paths;
      return { paths: server.paths, version: 2, inherited: [] };
    });
    render(wrap(<ContextDocPicker repoId="r1" owner={{ kind: "agent", id: "ag1" }} />));
    fireEvent.click(await screen.findByRole("button", { name: `Preview ${PATH}` }));
    const attach = await screen.findByRole("button", { name: "Attach" });
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("0 files · 0 tokens total");
    fireEvent.click(attach);
    expect(await screen.findByRole("button", { name: "Attached" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Attach ${PATH}` })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("1 file · 400 tokens total");
    fireEvent.click(screen.getByRole("button", { name: "Attached" }));
    expect(await screen.findByRole("button", { name: "Attach" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: `Attach ${PATH}` })).toHaveAttribute("aria-checked", "false");
    expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", { paths: [] });
  });

  it("pending / 404 \"no longer on main\" / 5xx with Retry; drawer stays open", async () => {
    // pending
    get.mockImplementation(() => new Promise(() => {}));
    const first = renderDrawer();
    expect(screen.getByRole("status", { name: "Loading preview…" })).toBeInTheDocument();
    first.unmount();

    // 404
    get.mockReset();
    qc.clear();
    get.mockRejectedValue(new ApiError("gone", 404));
    const second = renderDrawer();
    expect(await screen.findByText("This document is no longer on main")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    second.unmount();

    // 5xx then recovery via Retry
    get.mockReset();
    qc.clear();
    get.mockRejectedValueOnce(new ApiError("boom", 502)).mockResolvedValue(preview());
    renderDrawer();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load this document");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Security baseline" })).toBeInTheDocument();
  });

  it("422 not_text shows a distinct message without a Retry button", async () => {
    get.mockRejectedValue(new ApiError("not text", 422));
    renderDrawer();
    expect(await screen.findByText("This document isn’t valid UTF-8 text, so it can’t be previewed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn’t load this document")).not.toBeInTheDocument();
  });

  it("labeled dialog, Escape closes, focus returns to Preview button", async () => {
    const docs: ContextDoc[] = [
      { path: PATH, name: "security-baseline.md", folder: "specs", source: "specs", tokens: 400 },
    ];
    get.mockImplementation(async (url: string) => {
      if (url === "/repos/r1/context/docs")
        return { repo_id: "r1", branch: "main", commit_sha: "abc", docs };
      if (url === "/agents/ag1/context") return { paths: [], version: 1, inherited: [] };
      return preview();
    });
    render(wrap(<ContextDocPicker repoId="r1" owner={{ kind: "agent", id: "ag1" }} />));
    const opener = await screen.findByRole("button", { name: `Preview ${PATH}` });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: PATH });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();

    // close control also closes and returns focus
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("Escape calls onClose", async () => {
    get.mockResolvedValue(preview());
    const { onClose } = renderDrawer();
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
