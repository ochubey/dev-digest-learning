import { describe, it, expect } from "vitest";
import * as shared from "@devdigest/shared";
import * as mirror from "../components/ci-export/constants";

describe("client copy of CI contracts", () => {
  it("local CI constants equal the shared contract source", () => {
    expect([...mirror.CI_TRIGGERS]).toEqual([...shared.CI_TRIGGERS]);
    expect(mirror.CI_BRANCH).toBe(shared.CI_BRANCH);
    expect(mirror.CI_WORKFLOW_PATH).toBe(shared.CI_WORKFLOW_PATH);
    expect([...mirror.POST_AS_VALUES]).toEqual([...shared.CiPostAs.options]);
    expect([...mirror.FAIL_ON_VALUES]).toEqual([...shared.CiFailOn.options]);
  });
});
