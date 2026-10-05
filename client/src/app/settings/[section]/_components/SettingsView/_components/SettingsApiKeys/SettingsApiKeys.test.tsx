import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import settings from "../../../../../../../../messages/en/settings.json";

const state: { secrets: Record<string, boolean>; github: unknown } = {
  secrets: { openai: true, anthropic: false, openrouter: true, github: true },
  github: undefined,
};
vi.mock("../../../../../../../lib/hooks", () => ({
  useSecretsStatus: () => ({ data: state.secrets }),
  useGithubStatus: () => ({ data: state.github }),
  useTestConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SettingsApiKeys } from "./SettingsApiKeys";

afterEach(cleanup);
const renderKeys = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ settings }}>
      <SettingsApiKeys />
    </NextIntlClientProvider>,
  );

describe("SettingsApiKeys GitHub badge", () => {
  it("configured + accepted by GitHub: plain Configured, no invalid badge", () => {
    state.github = { configured: true, ok: true, login: "octocat" };
    renderKeys();
    expect(screen.queryByTestId("key-invalid")).not.toBeInTheDocument();
    expect(screen.getAllByText("Configured")).toHaveLength(3);
  });

  it("configured but rejected by GitHub: shows 'Invalid token' with the reason as tooltip", () => {
    state.github = { configured: true, ok: false, reason: "bad_credentials", message: "Bad credentials" };
    renderKeys();
    const badge = screen.getByTestId("key-invalid");
    expect(badge.textContent).toBe("Invalid token");
    expect(badge).toHaveAttribute("title", "Bad credentials");
    // other providers keep their own state
    expect(screen.getAllByText("Configured")).toHaveLength(2);
    expect(within(badge.closest("div")!.parentElement!).queryByText("Configured")).not.toBeInTheDocument();
  });

  it("not configured: stays 'Not set' (not flagged invalid)", () => {
    state.secrets = { ...state.secrets, github: false };
    state.github = { configured: false, ok: false, reason: "no_token" };
    renderKeys();
    expect(screen.queryByTestId("key-invalid")).not.toBeInTheDocument();
    state.secrets = { openai: true, anthropic: false, openrouter: true, github: true };
  });
});
