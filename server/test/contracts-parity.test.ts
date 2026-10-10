/**
 * The shared Zod contract is vendored twice (server + client). The two copies of
 * brief.ts must stay byte-identical (docs/plans/smart-diff.md §4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pair = (name: string) => ({
  server: `server/src/vendor/shared/contracts/${name}`,
  client: `client/src/vendor/shared/contracts/${name}`,
});

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)));

describe('vendored contracts parity', () => {
  for (const name of ['brief.ts', 'trace.ts', 'platform.ts']) {
    it(`${name} byte-identical`, () => {
      const { server, client } = pair(name);
      expect(
        read(server).equals(read(client)),
        `${server} and ${client} differ; keep the vendored copies identical`,
      ).toBe(true);
    });
  }
});
