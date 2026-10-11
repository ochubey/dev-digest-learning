import { parse } from 'yaml';
import type { CiWorkflowRule } from '@devdigest/shared';
import { BASE_SHA_REF, FORK_GUARD, SECRET_EXPR } from './workflow.js';

export type WorkflowCheck = { ok: true } | { ok: false; rule: CiWorkflowRule; message: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (rule: CiWorkflowRule, message: string): WorkflowCheck => ({ ok: false, rule, message });

const PINNED = /^[^@\s]+@[0-9a-f]{40}$/;
const SECRET_NAME = 'OPENROUTER_API_KEY';

function jobsOf(doc: Obj): [string, Obj][] {
  const jobs = doc.jobs;
  if (!isObj(jobs)) return [];
  return Object.entries(jobs).filter((e): e is [string, Obj] => isObj(e[1]));
}

function stepsOf(job: Obj): Obj[] {
  return Array.isArray(job.steps) ? job.steps.filter(isObj) : [];
}

/** The job `if` must require the fork guard: no `||`, no grouping, and the guard as an `&&` operand. */
function hasForkGuard(cond: unknown): boolean {
  if (typeof cond !== 'string') return false;
  let expr = cond.trim();
  const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(expr);
  if (wrapped) expr = (wrapped[1] ?? '').trim();
  if (expr.includes('||') || expr.includes('(') || expr.includes('${{')) return false;
  return expr.split('&&').some((part) => part.trim().replace(/\s+/g, ' ') === FORK_GUARD);
}

/** Every string leaf with its parent key, depth first. */
function leaves(node: unknown, key: string | null, out: { key: string | null; value: string }[]): void {
  if (typeof node === 'string') out.push({ key, value: node });
  else if (Array.isArray(node)) for (const v of node) leaves(v, key, out);
  else if (isObj(node)) for (const [k, v] of Object.entries(node)) leaves(v, k, out);
}

/** `run:` values at any depth. */
function runScripts(node: unknown, out: string[]): void {
  if (Array.isArray(node)) for (const v of node) runScripts(v, out);
  else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'run' && typeof v === 'string') out.push(v);
      else runScripts(v, out);
    }
  }
}

/** Every key named `OPENROUTER_API_KEY` at any depth, with its value. */
function secretKeys(node: unknown, out: unknown[]): void {
  if (Array.isArray(node)) for (const v of node) secretKeys(v, out);
  else if (isObj(node)) {
    for (const [k, v] of Object.entries(node)) {
      if (k === SECRET_NAME) out.push(v);
      secretKeys(v, out);
    }
  }
}

/**
 * Safety checks for a user-edited workflow (AC-29). Pure. YAML 1.2 keeps `on` a string key
 * (1.1 would turn it into `true`). Rules run in a fixed order; the first violation wins.
 */
export function checkWorkflow(text: string): WorkflowCheck {
  let doc: unknown;
  try {
    doc = parse(text, { version: '1.2', uniqueKeys: true });
  } catch (err) {
    return fail('yaml_invalid', `The workflow is not valid YAML: ${(err as Error).message.split('\n')[0]}`);
  }
  if (!isObj(doc)) return fail('yaml_invalid', 'The workflow must be a YAML mapping.');
  const jobs = jobsOf(doc);
  if (jobs.length === 0) return fail('yaml_invalid', 'The workflow defines no jobs.');

  // permissions: exactly contents: read + pull-requests: write, top level only
  const perms = doc.permissions;
  const permKeys = isObj(perms) ? Object.keys(perms).sort() : [];
  if (
    !isObj(perms) ||
    permKeys.join() !== 'contents,pull-requests' ||
    perms.contents !== 'read' ||
    perms['pull-requests'] !== 'write'
  ) {
    return fail('permissions_widened', 'Top-level permissions must be exactly "contents: read" and "pull-requests: write".');
  }
  if (jobs.some(([, job]) => 'permissions' in job)) {
    return fail('permissions_widened', 'Jobs must not declare their own permissions.');
  }

  const on = doc.on;
  if (!isObj(on) || Object.keys(on).join() !== 'pull_request') {
    return fail('forbidden_trigger', 'The workflow must trigger only on "pull_request".');
  }

  for (const [name, job] of jobs) {
    if (!hasForkGuard(job.if)) {
      return fail('fork_guard_missing', `Job "${name}" must run only when ${FORK_GUARD}.`);
    }
  }

  for (const [name, job] of jobs) {
    const checkouts = stepsOf(job).filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
    const good = checkouts.every((s) => {
      const w = isObj(s.with) ? s.with : {};
      return w.ref === BASE_SHA_REF && w['persist-credentials'] === false;
    });
    if (checkouts.length === 0 || !good) {
      return fail(
        'base_checkout_missing',
        `Job "${name}" must check out the PR base commit (ref: ${BASE_SHA_REF}) with persist-credentials: false.`,
      );
    }
  }

  for (const [name, job] of jobs) {
    const uses = [job.uses, ...stepsOf(job).map((s) => s.uses)].filter((u) => u !== undefined);
    const bad = uses.find((u) => typeof u !== 'string' || !PINNED.test(u));
    if (bad !== undefined) {
      return fail('action_not_pinned', `Job "${name}": "${String(bad)}" must be pinned to a full 40-character commit SHA.`);
    }
  }

  const scripts: string[] = [];
  runScripts(doc, scripts);
  if (scripts.some((s) => s.includes('${{'))) {
    return fail('expression_in_run', 'A run: script must not contain a ${{ }} expression; pass values through env.');
  }

  const keyed: unknown[] = [];
  secretKeys(doc, keyed);
  if (keyed.some((v) => v !== SECRET_EXPR)) {
    return fail('secret_misassigned', `${SECRET_NAME} must be assigned exactly ${SECRET_EXPR}.`);
  }
  const all: { key: string | null; value: string }[] = [];
  leaves(doc, null, all);
  const misused = all.some(
    (l) => /\$\{\{[^}]*\bsecrets\b/.test(l.value) && !(l.key === SECRET_NAME && l.value === SECRET_EXPR),
  );
  if (misused) {
    return fail('secret_misassigned', `Secrets may only be used as ${SECRET_NAME}: ${SECRET_EXPR}.`);
  }
  return { ok: true };
}
