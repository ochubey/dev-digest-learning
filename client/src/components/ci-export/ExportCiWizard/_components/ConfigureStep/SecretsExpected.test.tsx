import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import ciExport from "../../../../../../messages/en/ciExport.json";

const status = vi.hoisted(() => ({ value: {} as { data?: unknown; isError?: boolean } }));
const hook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/ci", () => ({
  useCiSecretStatus: (id: string | null) => {
    hook(id);
    return status.value;
  },
}));

import { ConfigureStep } from "./ConfigureStep";

afterEach(cleanup);

function renderStep(repoId: string | null = "r1", onTriggers = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ciExport }}>
      <ConfigureStep
        triggers={["opened"]}
        onTriggers={onTriggers}
        postAs="github_review"
        onPostAs={() => {}}
        failOn="warning"
        repoId={repoId}
        repo="acme/api"
      />
    </NextIntlClientProvider>,
  );
}

describe("Secrets expected panel", () => {
  it("shows the set state without a link, and GITHUB_TOKEN ready", () => {
    status.value = { data: { OPENROUTER_API_KEY: "set" } };
    renderStep();
    expect(hook).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Secrets expected")).toBeInTheDocument();
    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("Your OpenRouter key")).toBeInTheDocument();
    expect(screen.getByText("set")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText(/Add these to your repo's Actions secrets/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add it in Actions secrets" })).toBeNull();
  });

  it.each([
    [{ data: { OPENROUTER_API_KEY: "not_set" } }, "not set"],
    [{ data: { OPENROUTER_API_KEY: "unknown" } }, "could not check"],
    [{ isError: true }, "could not check"],
  ])("shows %j with a link to the repo Actions secrets", (value, label) => {
    status.value = value;
    renderStep();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add it in Actions secrets" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/settings/secrets/actions",
    );
  });

  it("shows checking while loading and never blocks the step", () => {
    status.value = {};
    const onTriggers = vi.fn();
    renderStep("r1", onTriggers);
    expect(screen.getByText("checking…")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("pull_request: synchronize"));
    expect(onTriggers).toHaveBeenCalled();
  });
});
