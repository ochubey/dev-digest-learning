/**
 * Deterministic project documents for acme/payments-api, served by FixtureProjectDocsSource
 * when PROJECT_DOCS_SOURCE=fixture (e2e and demo). Keyed by repo full name.
 */
export const PROJECT_DOCS_FIXTURE_SHA = 'f1xed00000000000000000000000000000000001';

export const PROJECT_DOCS_FIXTURE: Record<string, Record<string, string>> = {
  'acme/payments-api': {
    'specs/security-baseline.md': `# Security baseline

All code that touches payment data must meet this baseline.

- Secrets (API keys, tokens) must never be committed or logged.
- Every public endpoint must validate its input and enforce authentication.
- Card data is handled only through the tokenization service.
`,
    'specs/public-api.md': `# Public API contract

Public endpoints are versioned under \`/v1\`.

- Responses are JSON with a stable \`error.code\` field.
- Rate limits return \`429\` with a \`Retry-After\` header.
- Breaking changes require a new version prefix.
`,
    'docs/architecture.md': `# Architecture overview

The payments API is a Fastify service backed by Postgres.

- \`src/routes\` hold HTTP handlers; business rules live in \`src/services\`.
- Handlers never talk to the database directly.
- Background work runs through the job queue.
`,
    'insights/rate-limiting.md': `# Rate limiting notes

- The limiter keys on API key first, then client IP.
- Redis outages must fail open for read endpoints and fail closed for writes.
- Limits are configured in \`src/config.ts\`, not hard-coded in handlers.
`,
    'README.md': `# Payments API

Card payments service for the Acme storefront.

- Run \`pnpm dev\` to start the API locally.
- See \`docs/architecture.md\` for the service layout.
`,
    'client/specs/ui-components.md': `# UI components

Shared rules for the checkout client components.

- Components are presentational; data fetching lives in hooks.
- Every interactive element needs an accessible name.
- Money is formatted through the shared \`formatAmount\` helper.
`,
  },
};
