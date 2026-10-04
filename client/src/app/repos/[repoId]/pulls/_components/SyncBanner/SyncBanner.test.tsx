import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import prReview from "../../../../../../../messages/en/prReview.json";
import { SyncBanner } from "./SyncBanner";

afterEach(cleanup);

const renderBanner = (sync: Parameters<typeof SyncBanner>[0]["sync"]) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview }}>
      <SyncBanner sync={sync} />
    </NextIntlClientProvider>,
  );
const at = "2026-10-04T12:00:00Z";

describe("SyncBanner", () => {
  it("renders nothing while unknown or when the sync is ok", () => {
    renderBanner(undefined);
    expect(screen.queryByTestId("sync-banner")).not.toBeInTheDocument();
    cleanup();
    renderBanner({ ok: true, at });
    expect(screen.queryByTestId("sync-banner")).not.toBeInTheDocument();
  });

  it("bad credentials: explains the token problem, says saved PRs are shown, links to API key settings", () => {
    renderBanner({ ok: false, reason: "bad_credentials", status: 401, message: "Bad credentials", at });
    const banner = screen.getByTestId("sync-banner");
    expect(banner).toHaveAttribute("role", "alert");
    expect(banner.textContent).toContain("Couldn't sync pull requests from GitHub");
    expect(banner.textContent).toContain("GitHub rejected the token");
    expect(banner.textContent).toContain("Showing the pull requests saved earlier");
    expect(screen.getByRole("link", { name: "Open API key settings" })).toHaveAttribute("href", "/settings/api-keys");
  });

  it("no token also links to settings; no_access and rate_limited do not", () => {
    renderBanner({ ok: false, reason: "no_token", at });
    expect(screen.getByRole("link", { name: "Open API key settings" })).toBeInTheDocument();
    cleanup();
    renderBanner({ ok: false, reason: "no_access", status: 404, at });
    expect(screen.getByTestId("sync-banner").textContent).toContain("can't see this repository");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    cleanup();
    renderBanner({ ok: false, reason: "rate_limited", status: 429, at });
    expect(screen.getByTestId("sync-banner").textContent).toContain("rate limit");
  });

  it("generic errors show GitHub's message", () => {
    renderBanner({ ok: false, reason: "error", message: "socket hang up", at });
    expect(screen.getByTestId("sync-banner").textContent).toContain("socket hang up");
  });
});
