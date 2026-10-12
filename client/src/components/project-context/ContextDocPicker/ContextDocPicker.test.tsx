import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type {
  ContextDiscovery,
  ContextDoc,
  InheritedContextDoc,
} from "@devdigest/shared";
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

// Pointer/keyboard drags are impractical under jsdom (no layout): capture the
// DndContext drop handler and fire it directly.
let dragEnd: ((e: unknown) => void) | undefined;
vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
  const react = await import("react");
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: (e: unknown) => void } & Record<string, unknown>) => {
      dragEnd = props.onDragEnd;
      return react.createElement(actual.DndContext, props as never);
    },
  };
});

import { ApiError } from "@/lib/api";
import { sourceOfPath } from "../helpers";
import { ContextDocPicker } from "./ContextDocPicker";

const mkDoc = (path: string, tokens: number): ContextDoc => {
  const parts = path.split("/");
  return {
    path,
    name: parts[parts.length - 1]!,
    folder: parts.slice(0, -1).join("/"),
    source: sourceOfPath(path),
    tokens,
  };
};

const DOCS7: ContextDoc[] = [
  mkDoc("specs/security-baseline.md", 400),
  mkDoc("specs/public-api.md", 512),
  mkDoc("specs/a.md", 100),
  mkDoc("docs/architecture.md", 1234),
  mkDoc("docs/b.md", 640),
  mkDoc("insights/incident-1.md", 90),
  mkDoc("insights/incident-2.md", 70),
];

interface Server {
  docs: ContextDoc[];
  total?: number;
  truncated?: boolean;
  paths: string[];
  inherited: InheritedContextDoc[];
  version: number;
}
let server: Server;
const discovery = (docs: ContextDoc[], extra: { total?: number; truncated?: boolean } = {}): ContextDiscovery => ({
  repo_id: "r1",
  branch: "main",
  commit_sha: "abc",
  docs,
  total: extra.total ?? docs.length,
  truncated: extra.truncated ?? false,
});

function route() {
  get.mockImplementation(async (url: string) => {
    if (url === "/repos/r1/context/docs" || url === "/repos/r1/context/docs?refresh=1")
      return discovery(server.docs, { total: server.total, truncated: server.truncated });
    if (url === "/agents/ag1/context")
      return { paths: server.paths, version: server.version, inherited: server.inherited };
    throw new Error(`unexpected GET ${url}`);
  });
  put.mockImplementation(async (_url: string, body: { paths: string[] }) => {
    server.paths = body.paths;
    server.version += 1;
    return { paths: server.paths, version: server.version, inherited: server.inherited };
  });
}

let qc: QueryClient;
function renderPicker(props: Partial<React.ComponentProps<typeof ContextDocPicker>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      <QueryClientProvider client={qc}>
        <ContextDocPicker repoId="r1" owner={{ kind: "agent", id: "ag1" }} {...props} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const rowPaths = () =>
  screen.queryAllByTestId("context-doc-row").map((r) => r.getAttribute("data-path"));

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  dragEnd = undefined;
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server = { docs: DOCS7, paths: [], inherited: [], version: 1 };
  route();
});
afterEach(cleanup);

describe("ContextDocPicker", () => {
  it("three rows with handle, checkbox, name, folder, source badge, Preview", async () => {
    server.docs = [
      mkDoc("specs/a.md", 100),
      mkDoc("docs/sub/b.md", 200),
      mkDoc("insights/c.md", 300),
    ];
    server.paths = ["specs/a.md"];
    renderPicker();
    await waitFor(() => expect(screen.getAllByTestId("context-doc-row")).toHaveLength(3));
    const row = screen.getAllByTestId("context-doc-row")[0]!;
    expect(within(row).getByTestId("context-doc-handle")).toBeInTheDocument();
    expect(within(row).getByRole("checkbox", { name: "Attach specs/a.md" })).toBeInTheDocument();
    expect(within(row).getByText("a.md")).toBeInTheDocument();
    expect(within(row).getByText("specs", { selector: "[data-testid='context-doc-folder']" })).toBeInTheDocument();
    expect(within(row).getByTestId("context-doc-source")).toHaveTextContent("specs");
    expect(within(row).getByRole("button", { name: "Preview specs/a.md" })).toBeInTheDocument();
    expect(within(row).getByText("100 tokens")).toBeInTheDocument();
    const nested = screen.getAllByTestId("context-doc-row")[1]!;
    expect(within(nested).getByTestId("context-doc-folder")).toHaveTextContent("docs/sub");
  });

  it("\"2 of 7 attached\", stale not counted", async () => {
    server.paths = ["specs/a.md", "docs/gone.md", "docs/b.md"];
    renderPicker();
    expect(await screen.findByText("2 of 7 attached")).toBeInTheDocument();
  });

  it("filter SEC leaves security-baseline.md; badge and footer unchanged", async () => {
    server.paths = ["specs/a.md"];
    renderPicker();
    await screen.findByText("1 of 7 attached");
    const footerBefore = screen.getByTestId("context-footer-total").textContent;
    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents" }), {
      target: { value: "SEC" },
    });
    expect(rowPaths()).toEqual(["specs/security-baseline.md"]);
    expect(screen.getByText("1 of 7 attached")).toBeInTheDocument();
    expect(screen.getByTestId("context-footer-total").textContent).toBe(footerBefore);
  });

  it("no match -> \"No documents match\" with clear", async () => {
    renderPicker();
    await screen.findByText("0 of 7 attached");
    fireEvent.change(screen.getByRole("textbox", { name: "Filter documents" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No documents match \"zzz\"")).toBeInTheDocument();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(rowPaths()).toHaveLength(7);
  });

  it("empty -> No documents found + Re-index", async () => {
    server.docs = [];
    renderPicker();
    expect(await screen.findByText("No documents found")).toBeInTheDocument();
    expect(
      screen.getByText("Add markdown files to the repository's main branch, then Re-index."),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("specs/ ·");
    expect(screen.getAllByRole("button", { name: "Re-index" }).length).toBeGreaterThan(0);
  });

  it("truncated discovery shows the first-500 notice; complete discovery does not", async () => {
    server.truncated = true;
    server.total = 731;
    renderPicker();
    expect(await screen.findByText("Showing the first 500 of 731 documents.")).toBeInTheDocument();
    cleanup();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    server.truncated = false;
    renderPicker();
    await screen.findAllByTestId("context-doc-row");
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it("root and other documents get their own badge and order after insights", async () => {
    server.docs = [
      mkDoc("src/o.md", 1),
      mkDoc("README.md", 2),
      mkDoc("insights/i.md", 3),
      mkDoc("client/specs/x.md", 4),
    ];
    renderPicker();
    await screen.findAllByTestId("context-doc-row");
    expect(rowPaths()).toEqual(["client/specs/x.md", "insights/i.md", "README.md", "src/o.md"]);
    const badges = screen.getAllByTestId("context-doc-source").map((b) => b.textContent);
    expect(badges).toEqual(["specs", "insights", "root", "other"]);
  });

  it("no repository -> empty state with Re-index disabled and a hint", async () => {
    renderPicker({ repoId: null });
    expect(await screen.findByText("No documents found")).toBeInTheDocument();
    expect(screen.getByText(/Add a repository/)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: "Re-index" })) expect(b).toBeDisabled();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/repos/"));
  });

  it("Re-index: one request, disabled busy, new list", async () => {
    renderPicker();
    await screen.findByText("0 of 7 attached");
    let release!: (v: ContextDiscovery) => void;
    get.mockImplementation((url: string) => {
      if (url === "/repos/r1/context/docs?refresh=1")
        return new Promise<ContextDiscovery>((r) => (release = r));
      return Promise.resolve(discovery(server.docs));
    });
    const btn = screen.getByRole("button", { name: "Re-index" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    const busy = await screen.findByRole("button", { name: "Re-indexing…" });
    expect(busy).toBeDisabled();
    expect(get.mock.calls.filter((c) => String(c[0]).includes("refresh=1"))).toHaveLength(1);
    await act(async () => {
      release(discovery([mkDoc("specs/only.md", 5)]));
    });
    await waitFor(() => expect(rowPaths()).toEqual(["specs/only.md"]));
    expect(screen.getByText("0 of 1 attached")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-index" })).toBeEnabled();
  });

  it("loading placeholder, no empty state", async () => {
    get.mockImplementation((url: string) =>
      url === "/repos/r1/context/docs"
        ? new Promise(() => {})
        : Promise.resolve({ paths: [], version: 1, inherited: [] }),
    );
    renderPicker();
    expect(await screen.findByRole("status", { name: "Loading documents…" })).toBeInTheDocument();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("context-doc-row")).toHaveLength(0);
  });

  it("stale row \"Not found on main\", detachable, no Preview, excluded from total", async () => {
    server.paths = ["docs/gone.md", "specs/a.md"];
    renderPicker();
    await screen.findByText("1 of 7 attached");
    const stale = screen.getAllByTestId("context-doc-row")[0]!;
    expect(stale).toHaveAttribute("data-path", "docs/gone.md");
    expect(within(stale).getByText("Not found on main")).toBeInTheDocument();
    expect(within(stale).queryByRole("button", { name: /Preview/ })).not.toBeInTheDocument();
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("1 file · 100 tokens total");
    fireEvent.click(within(stale).getByRole("checkbox", { name: "Attach docs/gone.md" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/agents/ag1/context", { paths: ["specs/a.md"] }));
  });

  it("discovery error: alert + Retry + attached rows \"not verified\", no write", async () => {
    server.paths = ["specs/a.md"];
    get.mockImplementation(async (url: string) => {
      if (url === "/repos/r1/context/docs") throw new ApiError("GitHub is down", 502);
      return { paths: server.paths, version: 1, inherited: [] };
    });
    renderPicker();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t read the documents");
    const row = screen.getByTestId("context-doc-row");
    expect(row).toHaveAttribute("data-path", "specs/a.md");
    expect(within(row).getByText("Not verified")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    get.mockImplementation(async (url: string) =>
      url === "/repos/r1/context/docs"
        ? discovery(DOCS7)
        : { paths: server.paths, version: 1, inherited: [] },
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(rowPaths()).toHaveLength(7));
    expect(put).not.toHaveBeenCalled();
  });

  it("at 50 attached, unattached rows cannot be attached and a message explains why", async () => {
    const many = Array.from({ length: 51 }, (_, i) => mkDoc(`docs/d${String(i).padStart(2, "0")}.md`, 10));
    server.docs = many;
    server.paths = many.slice(0, 50).map((d) => d.path);
    renderPicker();
    await screen.findByText("50 of 51 attached");
    expect(screen.getByText("You can attach up to 50 documents. Detach one to add another.")).toBeInTheDocument();
    const blocked = screen.getByRole("checkbox", { name: "Attach docs/d50.md" });
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(put).not.toHaveBeenCalled();
    // Attached rows can still be detached.
    expect(screen.getByRole("checkbox", { name: "Attach docs/d00.md" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/d00.md" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/You can attach up to 50/)).not.toBeInTheDocument());
  });

  it("tick appends last; untick keeps order", async () => {
    server.paths = ["specs/a.md", "docs/b.md"];
    renderPicker();
    await screen.findByText("2 of 7 attached");
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach insights/incident-1.md" }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", {
        paths: ["specs/a.md", "docs/b.md", "insights/incident-1.md"],
      }),
    );
    await waitFor(() => expect(rowPaths().slice(0, 3)).toEqual(["specs/a.md", "docs/b.md", "insights/incident-1.md"]));
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/b.md" }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", {
        paths: ["specs/a.md", "insights/incident-1.md"],
      }),
    );
  });

  it("drag reorder persists; unattached handle inert", async () => {
    server.paths = ["specs/a.md", "docs/b.md", "specs/public-api.md"];
    renderPicker();
    await screen.findByText("3 of 7 attached");
    const rows = screen.getAllByTestId("context-doc-row");
    expect(within(rows[0]!).getByTestId("context-doc-handle")).toHaveAttribute("aria-roledescription");
    expect(
      within(screen.getAllByTestId("context-doc-row")[3]!).getByTestId("context-doc-handle"),
    ).not.toHaveAttribute("aria-roledescription");

    act(() => dragEnd?.({ active: { id: "specs/a.md" }, over: { id: "specs/public-api.md" } }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", {
        paths: ["docs/b.md", "specs/public-api.md", "specs/a.md"],
      }),
    );
    put.mockClear();
    // dropping on / dragging an unattached row is inert
    act(() => dragEnd?.({ active: { id: "specs/a.md" }, over: { id: "docs/architecture.md" } }));
    act(() => dragEnd?.({ active: { id: "docs/architecture.md" }, over: { id: "specs/a.md" } }));
    expect(put).not.toHaveBeenCalled();
  });

  it("keyboard move up/down persists same order", async () => {
    server.paths = ["specs/a.md", "docs/b.md", "specs/public-api.md"];
    renderPicker();
    await screen.findByText("3 of 7 attached");
    fireEvent.click(screen.getByRole("button", { name: "Move docs/b.md up" }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", {
        paths: ["docs/b.md", "specs/a.md", "specs/public-api.md"],
      }),
    );
    await waitFor(() => expect(rowPaths().slice(0, 3)).toEqual(["docs/b.md", "specs/a.md", "specs/public-api.md"]));
    fireEvent.click(screen.getByRole("button", { name: "Move docs/b.md down" }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith("/agents/ag1/context", {
        paths: ["specs/a.md", "docs/b.md", "specs/public-api.md"],
      }),
    );
    // first can't go up, last can't go down
    expect(screen.getByRole("button", { name: "Move specs/a.md up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move specs/public-api.md down" })).toBeDisabled();
  });

  it("failed write restores list + message", async () => {
    server.paths = ["specs/a.md"];
    renderPicker();
    await screen.findByText("1 of 7 attached");
    put.mockRejectedValue(new ApiError("nope", 500));
    fireEvent.click(screen.getByRole("checkbox", { name: "Attach docs/b.md" }));
    expect(await screen.findByText("Couldn’t save the change. The previous list was restored.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 of 7 attached")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "Attach docs/b.md" })).toHaveAttribute("aria-checked", "false");
    expect(rowPaths()[0]).toBe("specs/a.md");
  });

  it("footer text, warning badge at 4001 only with icon + text, checkbox enabled", async () => {
    server.docs = [mkDoc("docs/big.md", 4000), mkDoc("docs/one.md", 1), mkDoc("docs/two.md", 5)];
    server.paths = ["docs/big.md"];
    renderPicker();
    await screen.findByText("1 of 3 attached");
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("1 file · 4K tokens total");
    expect(screen.queryByText("over 4K soft cap")).not.toBeInTheDocument();

    const unticked = screen.getByRole("checkbox", { name: "Attach docs/one.md" });
    fireEvent.click(unticked);
    const badge = await screen.findByText("over 4K soft cap");
    expect(badge.closest("[data-testid='context-soft-cap']")?.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("2 files · 4K tokens total");
    // still attachable above the cap
    expect(screen.getByRole("checkbox", { name: "Attach docs/two.md" })).toBeEnabled();
    expect(screen.queryByText(/chunk/i)).not.toBeInTheDocument();
  });

  it("footer note text", async () => {
    renderPicker();
    expect(
      await screen.findByText("Injected as an untrusted block (## Project context) into every run."),
    ).toBeInTheDocument();
  });

  it("inherited \"via <skill>\" row read-only and counted", async () => {
    server.paths = ["specs/a.md"];
    server.inherited = [{ path: "docs/b.md", skill_id: "sk1", skill_name: "no-any" }];
    renderPicker();
    await screen.findByText("1 of 7 attached");
    const inh = screen.getAllByTestId("context-doc-row")[0]!;
    expect(inh).toHaveAttribute("data-path", "docs/b.md");
    expect(within(inh).getByText("via no-any")).toBeInTheDocument();
    expect(within(inh).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(inh).queryByTestId("context-doc-handle")).not.toBeInTheDocument();
    // 100 (own) + 640 (inherited) = 740 over 2 files
    expect(screen.getByTestId("context-footer-total")).toHaveTextContent("2 files · 740 tokens total");
  });
});
