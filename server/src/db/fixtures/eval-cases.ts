import type {
  EvalCaseOrigin,
  EvalCaseResult,
  EvalDroppedFinding,
  EvalExpectation,
  EvalResultFinding,
  EvalRunCounts,
  EvalRunMetrics,
} from '@devdigest/shared';

/**
 * Pure data for the eval pipeline demo (SPEC-03 AC-73, AC-78): the seeded case set of the
 * Security Reviewer and, in fixture mode, two finished suite runs with fixed case results.
 * No DB imports; `seed.ts` writes these rows.
 */

/** One unified-diff section from its body lines (' ' context, '+' added, '-' removed). */
function section(path: string, oldStart: number, newStart: number, body: string[], hunkContext = ''): string {
  const oldN = body.filter((l) => l[0] !== '+').length;
  const newN = body.filter((l) => l[0] !== '-').length;
  return (
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${oldStart},${oldN} +${newStart},${newN} @@${hunkContext ? ` ${hunkContext}` : ''}`,
      ...body,
    ].join('\n') + '\n'
  );
}

export interface SeedEvalCase {
  /** Stable key stored in `input_meta.seed_key`. */
  seed_key: string;
  name: string;
  origin: EvalCaseOrigin;
  expectation: EvalExpectation;
  input_diff: string;
  /** Present on the two cases derived from the seeded demo findings (PR #482, review model "seed"). */
  derived_from?: { file: string; title: string; decision: 'accepted' | 'dismissed' };
}

export const SEED_EVAL_CASES: SeedEvalCase[] = [
  {
    seed_key: 'hardcoded-stripe-key',
    name: 'Hardcoded Stripe secret key',
    origin: 'accepted_finding',
    expectation: { kind: 'must_find', file: 'src/config.ts', start_line: 12, end_line: 12 },
    derived_from: { file: 'src/config.ts', title: 'Hardcoded Stripe secret key in commit', decision: 'accepted' },
    input_diff: section(
      'src/config.ts',
      9,
      9,
      [
        '   port: 3000,',
        '   env: process.env.NODE_ENV,',
        '   logLevel: "info",',
        "+  stripeSecretKey: 'sk_live_EXAMPLE_NOT_A_REAL_KEY',",
        '+  rateLimit: {',
        '+    windowMs: 60_000,',
        '+    max: 100,',
        '+  },',
        ' };',
      ],
      'export const config = {',
    ),
  },
  {
    seed_key: 'ssrf-webhook-url',
    name: 'Server fetches a caller-supplied webhook URL',
    origin: 'seeded',
    expectation: { kind: 'must_find', file: 'src/api/public/webhooks.ts', start_line: 22, end_line: 23 },
    input_diff: section('src/api/public/webhooks.ts', 20, 20, [
      ' export async function registerWebhook(app: FastifyInstance) {',
      '   app.post("/webhooks/register", async (req, reply) => {',
      '-    await saveEndpoint(req.body.callbackUrl);',
      '+    const { callbackUrl } = req.body as { callbackUrl: string };',
      '+    const probe = await fetch(callbackUrl, { method: "HEAD" });',
      '+    if (!probe.ok) return reply.code(422).send({ error: "callback_unreachable" });',
      '+    await saveEndpoint(callbackUrl);',
      '     return reply.code(201).send({ ok: true });',
      '   });',
      ' }',
    ]),
  },
  {
    seed_key: 'missing-retry-after',
    name: 'Rate-limit rejection without a Retry-After header',
    origin: 'seeded',
    expectation: { kind: 'must_find', file: 'src/middleware/ratelimit.ts', start_line: 17, end_line: 17 },
    input_diff: section('src/middleware/ratelimit.ts', 14, 14, [
      '   bucket.updatedAt = now;',
      '-  if (bucket.tokens < 1) return reply.code(429).send({ error: "rate_limited" });',
      '+  if (bucket.tokens < 1) {',
      '+    buckets.set(req.ip, bucket);',
      '+    return reply.code(429).send({ error: "rate_limited" });',
      '+  }',
      '   bucket.tokens -= 1;',
      '   buckets.set(req.ip, bucket);',
    ]),
  },
  {
    seed_key: 'service-role-key-in-client',
    name: 'Service-role key read in a browser module',
    origin: 'seeded',
    expectation: { kind: 'must_find', file: 'src/app/lib/supabase.ts', start_line: 5, end_line: 7 },
    input_diff: section('src/app/lib/supabase.ts', 1, 1, [
      ' "use client";',
      ' import { createClient } from "@supabase/supabase-js";',
      ' ',
      '-export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);',
      '+const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;',
      '+const key = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!;',
      '+',
      '+export const supabase = createClient(url, key);',
    ]),
  },
  {
    seed_key: 'sql-string-concat',
    name: 'User search builds SQL by string concatenation',
    origin: 'seeded',
    expectation: { kind: 'must_find', file: 'src/api/users.ts', start_line: 61, end_line: 62 },
    input_diff: section('src/api/users.ts', 60, 60, [
      ' export async function searchUsers(term: string) {',
      '-  return pool.query("SELECT id, email, name FROM users WHERE name LIKE $1", [`%${term}%`]);',
      `+  const query = "SELECT id, email, name FROM users WHERE name LIKE '%" + term + "%'";`,
      '+  const result = await pool.query(query);',
      '+  return result.rows;',
      ' }',
    ]),
  },
  {
    seed_key: 'unused-import',
    name: 'Unused import added to the webhooks module',
    origin: 'seeded',
    expectation: { kind: 'must_not_flag', file: 'src/api/public/webhooks.ts', start_line: 2, end_line: 2 },
    input_diff: section('src/api/public/webhooks.ts', 1, 1, [
      ' import type { FastifyInstance } from "fastify";',
      '+import crypto from "node:crypto";',
      ' import { handle } from "./handler";',
      ' ',
      ' export async function webhooks(app: FastifyInstance) {',
      '   app.post("/webhooks/github", async (req) => handle(req.body));',
      ' }',
    ]),
  },
  {
    seed_key: 'raw-body-parser-verified-webhook',
    name: 'Raw body parser for a signature-verified webhook',
    origin: 'seeded',
    expectation: { kind: 'must_not_flag', file: 'src/api/public/stripe-webhook.ts', start_line: 11, end_line: 11 },
    input_diff: section('src/api/public/stripe-webhook.ts', 10, 10, [
      ' export async function stripeWebhook(app: FastifyInstance) {',
      '-  app.post("/webhooks/stripe", async (req) => handleEvent(req.body));',
      '+  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));',
      '+  app.post("/webhooks/stripe", async (req, reply) => {',
      '+    const event = stripe.webhooks.constructEvent(',
      '+      req.body as Buffer,',
      '+      req.headers["stripe-signature"] as string,',
      '+      process.env.STRIPE_WEBHOOK_SECRET!,',
      '+    );',
      '+    await handleEvent(event);',
      '+    return reply.code(200).send({ received: true });',
      '+  });',
      ' }',
    ]),
  },
  {
    seed_key: 'clean-refactor-rename',
    name: 'Rename of an invoice total helper',
    origin: 'seeded',
    expectation: { kind: 'must_not_flag', file: 'src/services/invoices.ts', start_line: 15, end_line: 20 },
    input_diff: section('src/services/invoices.ts', 15, 15, [
      '-export function calcTotal(items: LineItem[]): number {',
      '+export function computeInvoiceTotal(items: LineItem[]): number {',
      '   return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);',
      ' }',
      ' ',
      ' export function summarize(invoice: Invoice) {',
      '-  const total = calcTotal(invoice.items);',
      '+  const total = computeInvoiceTotal(invoice.items);',
      '   return { id: invoice.id, total };',
      ' }',
    ]),
  },
  {
    seed_key: 'n-plus-one-user-list',
    name: 'Per-user orders query in the user list',
    origin: 'dismissed_finding',
    expectation: { kind: 'must_not_flag', file: 'src/api/users.ts', start_line: 45, end_line: 52 },
    derived_from: { file: 'src/api/users.ts', title: 'N+1 query in user list endpoint', decision: 'dismissed' },
    input_diff: section(
      'src/api/users.ts',
      44,
      44,
      [
        '   const users = await db.select().from(usersTable);',
        '-  const orders = await db.select().from(ordersTable);',
        '-  return users.map((u) => ({ ...u, orders: orders.filter((o) => o.userId === u.id) }));',
        '+  const out = [];',
        '+  for (const u of users) {',
        '+    const orders = await db.select().from(ordersTable).where(eq(ordersTable.userId, u.id));',
        '+    out.push({ ...u, orders });',
        '+  }',
        '+  return out;',
        ' }',
      ],
      'export async function listUsers() {',
    ),
  },
];

// ============================================================ seeded suite runs (fixture mode)

/** Appended to the Security Reviewer prompt when the fixture bumps it from v1 to v2 (A-3). */
export const SEED_EVAL_PROMPT_V2_SUFFIX =
  '\n\nReport an issue only when you can tie it to attacker-controlled input or to a committed secret; stay silent on style and on code you cannot show to be exploitable.';

export const SEED_EVAL_RUN_V1_ID = '5eed0000-0000-4000-8000-000000000e01';
export const SEED_EVAL_RUN_V2_ID = '5eed0000-0000-4000-8000-000000000e02';

export interface SeedEvalResult extends EvalCaseResult {
  /** `seed_key` of the case; `seed.ts` resolves `case_id` from it. */
  seed_key: string;
}

export interface SeedEvalRun {
  id: string;
  /** The agent version this run reports (v1 = the shipped prompt, v2 = prompt + suffix). */
  agent_version: 1 | 2;
  status: 'completed';
  started_at: string;
  finished_at: string;
  metrics: EvalRunMetrics;
  counts: EvalRunCounts;
  duration_ms: number;
  cost_usd: number;
  results: SeedEvalResult[];
}

const finding = (
  file: string,
  start_line: number,
  end_line: number,
  title: string,
  match: EvalResultFinding['match'],
  severity: EvalResultFinding['severity'] = 'WARNING',
  category: EvalResultFinding['category'] = 'security',
): EvalResultFinding => ({ file, start_line, end_line, severity, category, title, match });

function caseOf(key: string): SeedEvalCase {
  const c = SEED_EVAL_CASES.find((x) => x.seed_key === key);
  if (!c) throw new Error(`unknown seed case ${key}`);
  return c;
}

function result(
  runNo: 1 | 2,
  index: number,
  key: string,
  grounded: EvalResultFinding[],
  dropped: EvalDroppedFinding[] = [],
): SeedEvalResult {
  const c = caseOf(key);
  const labelled = (m: EvalResultFinding['match']) => grounded.some((f) => f.match === m);
  return {
    seed_key: key,
    id: `5eed0000-0000-4000-8000-0000000e${runNo}${String(index + 1).padStart(3, '0')}`,
    case_id: null,
    case_name: c.name,
    expectation: c.expectation,
    origin: c.origin,
    status: 'ok',
    pass: c.expectation.kind === 'must_find' ? labelled('tp') : !labelled('fp_zone'),
    grounded,
    dropped,
    duration_ms: 1400 + index * 120,
    tokens_in: 900 + index * 35,
    tokens_out: 110 + index * 8,
    cost_usd: 0.0011,
    error: null,
  };
}

function run(
  runNo: 1 | 2,
  fields: Pick<SeedEvalRun, 'started_at' | 'finished_at' | 'metrics' | 'counts'>,
  results: SeedEvalResult[],
): SeedEvalRun {
  return {
    id: runNo === 1 ? SEED_EVAL_RUN_V1_ID : SEED_EVAL_RUN_V2_ID,
    agent_version: runNo,
    status: 'completed',
    ...fields,
    // Same left-to-right sums as finalizeRun, so the stored totals equal a recomputation.
    duration_ms: results.reduce((s, r) => s + (r.duration_ms ?? 0), 0),
    cost_usd: results.reduce((s, r) => s + (r.cost_usd ?? 0), 0),
    results,
  };
}

const CONFIG = 'src/config.ts';
const WEBHOOKS = 'src/api/public/webhooks.ts';
const STRIPE_WEBHOOK = 'src/api/public/stripe-webhook.ts';
const RATELIMIT = 'src/middleware/ratelimit.ts';
const SUPABASE = 'src/app/lib/supabase.ts';
const USERS = 'src/api/users.ts';
const INVOICES = 'src/services/invoices.ts';

const stripeHit = finding(CONFIG, 12, 12, 'Hardcoded Stripe secret key', 'tp', 'CRITICAL');
const ssrfHit = finding(WEBHOOKS, 23, 23, 'Server-side request to a caller-supplied URL', 'tp');
const retryHit = finding(RATELIMIT, 17, 17, '429 response lacks a Retry-After header', 'tp', 'SUGGESTION', 'bug');
const renameNoise = finding(INVOICES, 20, 20, 'Renamed helper changes the computed total', 'fp_zone', 'SUGGESTION', 'bug');

/**
 * Run v1: recall 3/5, precision 3/6. Run v2 (prompt + suffix): recall 4/5, precision 4/6. Versus v1:
 * `service-role-key-in-client` and `unused-import` are fixed, `raw-body-parser-verified-webhook`
 * regressed, the rest keep their outcome.
 */
export const SEED_EVAL_RUNS: SeedEvalRun[] = [
  run(
    1,
    {
      started_at: '2026-10-09T10:00:00.000Z',
      finished_at: '2026-10-09T10:00:14.000Z',
      metrics: { recall: 3 / 5, precision: 3 / 6, citation_accuracy: 6 / 7 },
      counts: {
        cases_scored: 9,
        cases_passed: 5,
        must_find_total: 5,
        must_find_hit: 3,
        must_not_flag_total: 4,
        must_not_flag_violated: 2,
        tp: 3,
        fp_zone: 2,
        fp_unlabeled: 1,
        grounded: 6,
        dropped: 1,
        cases_errored: 0,
      },
    },
    [
      result(1, 0, 'hardcoded-stripe-key', [stripeHit]),
      result(1, 1, 'ssrf-webhook-url', [ssrfHit]),
      result(1, 2, 'missing-retry-after', [retryHit]),
      result(1, 3, 'service-role-key-in-client', [], [
        { file: SUPABASE, start_line: 40, end_line: 40, title: 'Public environment variable exposes a key', reason: 'line outside the diff' },
      ]),
      result(1, 4, 'sql-string-concat', [finding(USERS, 63, 63, 'Result rows returned unfiltered', 'unlabeled', 'SUGGESTION', 'bug')]),
      result(1, 5, 'unused-import', [finding(WEBHOOKS, 2, 2, 'Unused import of node:crypto', 'fp_zone', 'SUGGESTION', 'style')]),
      result(1, 6, 'raw-body-parser-verified-webhook', []),
      result(1, 7, 'clean-refactor-rename', [renameNoise]),
      result(1, 8, 'n-plus-one-user-list', []),
    ],
  ),
  run(
    2,
    {
      started_at: '2026-10-10T10:00:00.000Z',
      finished_at: '2026-10-10T10:00:13.000Z',
      metrics: { recall: 4 / 5, precision: 4 / 6, citation_accuracy: 6 / 6 },
      counts: {
        cases_scored: 9,
        cases_passed: 6,
        must_find_total: 5,
        must_find_hit: 4,
        must_not_flag_total: 4,
        must_not_flag_violated: 2,
        tp: 4,
        fp_zone: 2,
        fp_unlabeled: 0,
        grounded: 6,
        dropped: 0,
        cases_errored: 0,
      },
    },
    [
      result(2, 0, 'hardcoded-stripe-key', [stripeHit]),
      result(2, 1, 'ssrf-webhook-url', [ssrfHit]),
      result(2, 2, 'missing-retry-after', [retryHit]),
      result(2, 3, 'service-role-key-in-client', [
        finding(SUPABASE, 5, 5, 'Service-role key read in a client module', 'tp', 'CRITICAL'),
      ]),
      result(2, 4, 'sql-string-concat', []),
      result(2, 5, 'unused-import', []),
      result(2, 6, 'raw-body-parser-verified-webhook', [
        finding(STRIPE_WEBHOOK, 11, 11, 'Raw body parser bypasses payload validation', 'fp_zone', 'SUGGESTION', 'bug'),
      ]),
      result(2, 7, 'clean-refactor-rename', [renameNoise]),
      result(2, 8, 'n-plus-one-user-list', []),
    ],
  ),
];
