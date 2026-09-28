/* PreviewTab — renders the skill body as markdown. Reuses @devdigest/ui's
   `Markdown` (react-markdown + remark-gfm, no rehype-raw plugin registered)
   rather than hand-rolling a parser: it already satisfies the "no raw HTML"
   security requirement (no `dangerouslySetInnerHTML` anywhere in it, and
   react-markdown does not render raw HTML unless rehype-raw is explicitly
   added, which it is not here), is already vetted/used elsewhere in this
   app, and avoids duplicating markdown-parsing logic. */
"use client";

import React from "react";
import { EmptyState, Markdown } from "@devdigest/ui";

export function PreviewTab({ body }: { body: string }) {
  if (!body.trim()) {
    return <EmptyState icon="FileText" title="Nothing to preview" body="This skill's body is empty." />;
  }
  return (
    <div style={{ maxWidth: 760 }}>
      <Markdown>{body}</Markdown>
    </div>
  );
}
