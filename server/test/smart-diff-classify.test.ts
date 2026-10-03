import { describe, it, expect } from 'vitest';
import { classifyFile } from '../src/modules/reviews/smart-diff/classify.js';
import { GROUP_ORDER } from '../src/modules/reviews/smart-diff/constants.js';
import { SmartDiffRole } from '@devdigest/shared';

/**
 * Path → role table. Rules are evaluated boilerplate → tests → wiring → docs →
 * core, first match wins, default core. The last three rows are the disputed
 * paths whose roles are fixed by docs/plans/smart-diff.md.
 */
const TABLE: Array<[string, SmartDiffRole]> = [
  // boilerplate
  ['pnpm-lock.yaml', 'boilerplate'],
  ['server/pnpm-lock.yaml', 'boilerplate'],
  ['e2e/package-lock.json', 'boilerplate'],
  ['yarn.lock', 'boilerplate'],
  ['server/src/db/migrations/0004_add_col.sql', 'boilerplate'],
  ['server/src/db/migrations/meta/_journal.json', 'boilerplate'],
  ['client/src/__generated__/api.ts', 'boilerplate'],
  ['src/schema.generated.ts', 'boilerplate'],
  ['public/app.min.js', 'boilerplate'],
  ['dist/index.js', 'boilerplate'],
  ['client/src/__snapshots__/Foo.test.tsx.snap', 'boilerplate'],
  // tests
  ['server/test/grounding.test.ts', 'tests'],
  ['server/test/reviews.it.test.ts', 'tests'],
  ['client/src/components/Foo/Foo.spec.tsx', 'tests'],
  ['server/src/modules/reviews/__tests__/helpers.ts', 'tests'],
  ['e2e/specs/review.ts', 'tests'],
  ['server/vitest.config.ts', 'tests'],
  // wiring
  ['package.json', 'wiring'],
  ['server/tsconfig.json', 'wiring'],
  ['client/next.config.ts', 'wiring'],
  ['server/drizzle.config.ts', 'wiring'],
  ['.github/workflows/server-unit.yml', 'wiring'],
  ['docker-compose.yml', 'wiring'],
  ['scripts/dev.sh', 'wiring'],
  ['client/src/components/diff-viewer/index.ts', 'wiring'],
  ['server/src/modules/index.ts', 'wiring'],
  // docs
  ['README.md', 'docs'],
  ['docs/plans/smart-diff.md', 'docs'],
  ['server/README.md', 'docs'],
  ['CHANGELOG', 'docs'],
  // core (default)
  ['server/src/modules/reviews/service.ts', 'core'],
  ['client/src/components/diff-viewer/FileCard/FileCard.tsx', 'core'],
  ['server/src/vendor/shared/contracts/brief.ts', 'core'],
  ['client/src/vendor/ui/primitives/tokens.ts', 'core'],
  ['client/next-env.d.ts', 'core'],
  ['client/public/logo.svg', 'core'],
  // disputed paths (fixed in the plan)
  ['server/src/__tests__/__snapshots__/x.snap', 'boilerplate'],
  ['.claude/skills/security/SKILL.md', 'wiring'],
  ['e2e/README.md', 'tests'],
];

describe('classifyFile', () => {
  it.each(TABLE)('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('normalises Windows separators and case', () => {
    expect(classifyFile('Server\\Test\\Grounding.TEST.ts')).toBe('tests');
    expect(classifyFile('DOCS\\Plan.MD')).toBe('docs');
  });

  it('only returns known roles', () => {
    for (const [path] of TABLE) {
      expect(SmartDiffRole.safeParse(classifyFile(path)).success).toBe(true);
    }
  });
});

describe('GROUP_ORDER', () => {
  it('is core → tests → wiring → docs → boilerplate', () => {
    expect([...GROUP_ORDER]).toEqual(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
  });
});
