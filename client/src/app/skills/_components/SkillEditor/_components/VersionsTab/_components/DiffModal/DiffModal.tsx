/* DiffModal — word-level diff of a prior version's body against the
   skill's CURRENT body. Renders inline additions/deletions (green/red),
   ported algorithm from the design mock's diffTokens (see ../../helpers.ts). */
"use client";

import React from "react";
import { Modal, Button } from "@devdigest/ui";
import { diffTokens } from "../../helpers";
import { s } from "./styles";

export function DiffModal({
  version,
  oldBody,
  currentBody,
  onClose,
}: {
  version: number;
  oldBody: string;
  currentBody: string;
  onClose: () => void;
}) {
  const tokens = React.useMemo(() => diffTokens(oldBody, currentBody), [oldBody, currentBody]);

  return (
    <Modal
      width={760}
      title={`Diff v${version} → current`}
      subtitle="Word-level diff — removed in red, added in green"
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div style={s.body}>
        <pre style={s.pre}>
          {tokens.map((tok, idx) => (
            <span key={idx} style={tok.k === "del" ? s.del : tok.k === "add" ? s.add : s.same}>
              {tok.t}
            </span>
          ))}
        </pre>
      </div>
    </Modal>
  );
}
