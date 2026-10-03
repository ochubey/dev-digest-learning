/**
 * The shared Zod contract is vendored twice (server + client). The two copies of
 * brief.ts must stay byte-identical (docs/plans/smart-diff.md §4).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SERVER_FILE = 'server/src/vendor/shared/contracts/brief.ts';
const CLIENT_FILE = 'client/src/vendor/shared/contracts/brief.ts';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)));

describe('vendored contracts parity', () => {
  it('brief.ts is byte-identical on server and client', () => {
    const a = read(SERVER_FILE);
    const b = read(CLIENT_FILE);
    expect(
      a.equals(b),
      `${SERVER_FILE} and ${CLIENT_FILE} differ; keep the vendored copies identical`,
    ).toBe(true);
  });
});
