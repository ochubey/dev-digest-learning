import React from "react";
import { render, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import agentPerformance from "../../../messages/en/agentPerformance.json";
import runs from "../../../messages/en/runs.json";
import common from "../../../messages/en/common.json";

/** Test-only: the message files are loaded explicitly, as the app does through i18n/request.ts. */
export const messages = { agentPerformance, runs, common };

function Intl({ children }: { children: React.ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(ui: React.ReactElement): RenderResult {
  return render(ui, { wrapper: Intl });
}
