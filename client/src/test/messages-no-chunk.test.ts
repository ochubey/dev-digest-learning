import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "..", "messages", "en");

function* values(node: unknown, trail: string): Generator<[string, string]> {
  if (typeof node === "string") yield [trail, node];
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) yield* values(v, `${trail}.${k}`);
  }
}

describe("messages", () => {
  it("no message value contains \"chunk\"", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
      const json = JSON.parse(readFileSync(join(DIR, file), "utf8"));
      for (const [path, value] of values(json, file)) {
        if (/chunk/i.test(value)) offenders.push(`${path}: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the project-context footer wording is 'files … tokens total'", () => {
    const json = JSON.parse(readFileSync(join(DIR, "projectContext.json"), "utf8"));
    expect(json.footer.total).toMatch(/files/);
    expect(json.footer.total).toMatch(/tokens total/);
  });
});
