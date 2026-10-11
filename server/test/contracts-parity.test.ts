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
  for (const name of ['brief.ts', 'trace.ts', 'platform.ts', 'observability.ts', 'review-api.ts']) {
    it(`${name} byte-identical`, () => {
      const { server, client } = pair(name);
      expect(
        read(server).equals(read(client)),
        `${server} and ${client} differ; keep the vendored copies identical`,
      ).toBe(true);
    });
  }

  it('eval-ci.ts SPEC-03 block byte-identical', () => {
    const begin = '// ==== SPEC-03 eval pipeline: begin ====';
    const end = '// ==== SPEC-03 eval pipeline: end ====';
    const block = (rel: string) => {
      const text = read(rel).toString('utf8');
      expect(text.split(begin).length, `${rel}: missing or duplicate begin marker`).toBe(2);
      expect(text.split(end).length, `${rel}: missing or duplicate end marker`).toBe(2);
      const from = text.indexOf(begin);
      const to = text.indexOf(end);
      expect(to, `${rel}: end marker before begin marker`).toBeGreaterThan(from);
      return text.slice(from, to + end.length);
    };
    const { server, client } = pair('eval-ci.ts');
    expect(block(server), `${server} and ${client} SPEC-03 blocks differ`).toBe(block(client));
  });
});
