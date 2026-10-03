import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff path rules. Patterns match the normalised path (forward slashes,
 * lower-cased). Rules are evaluated in this order and the first match wins;
 * anything unmatched is `core`. See docs/plans/smart-diff.md §3.
 */
export interface RoleRule {
  role: SmartDiffRole;
  patterns: RegExp[];
}

export const ROLE_RULES: ReadonlyArray<RoleRule> = [
  {
    role: 'boilerplate',
    patterns: [
      // lock files
      /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|cargo\.lock|poetry\.lock|go\.sum|gemfile\.lock|composer\.lock)$/,
      // DB migrations (incl. drizzle meta)
      /(^|\/)(migrations?|drizzle)\//,
      // generated / minified / source maps
      /(^|\/)(generated|__generated__)\//,
      /\.generated\.[a-z]+$/,
      /\.min\.(js|css)$/,
      /\.map$/,
      // snapshots
      /(^|\/)__snapshots__\//,
      /\.snap$/,
      // build artifacts
      /(^|\/)(node_modules|dist|build|\.next|coverage)\//,
    ],
  },
  {
    role: 'tests',
    patterns: [
      /\.(test|spec)\.[cm]?[jt]sx?$/,
      /(^|\/)(__tests__|tests?|e2e|__mocks__|fixtures)\//,
      /(^|\/)(vitest|jest|playwright)\.config\.[a-z]+$/,
    ],
  },
  {
    role: 'wiring',
    patterns: [
      // manifests
      /(^|\/)package\.json$/,
      /(^|\/)tsconfig(\..+)?\.json$/,
      // configs and infra
      /\.config\.[cm]?[jt]s$/,
      /\.env(\..+)?\.example$/,
      /(^|\/)dockerfile/,
      /(^|\/)docker-compose/,
      /\.ya?ml$/,
      /(^|\/)\.github\//,
      /(^|\/)scripts\//,
      // barrels and module registration
      /(^|\/)index\.[jt]sx?$/,
      // agent / skill configuration
      /(^|\/)\.claude\//,
    ],
  },
  {
    role: 'docs',
    patterns: [
      /\.(md|mdx|rst|txt)$/,
      /(^|\/)docs?\//,
      /(^|\/)(license|changelog|contributing)/,
    ],
  },
];

/** Role for paths no rule matches. */
export const DEFAULT_ROLE: SmartDiffRole = 'core';

/** Display order of groups (distinct from the rule evaluation order above). */
export const GROUP_ORDER: ReadonlyArray<SmartDiffRole> = [
  'core',
  'tests',
  'wiring',
  'docs',
  'boilerplate',
];
