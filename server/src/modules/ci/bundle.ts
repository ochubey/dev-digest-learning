import { stringify } from 'yaml';
import { AgentManifest, type CiFile, type CiPostAs, type CiTrigger } from '@devdigest/shared';
import { AppError } from '../../platform/errors.js';
import { AGENTS_DIR, MEMORY_PATH, RUNNER_PATH, SKILLS_DIR, workflowPath } from './constants.js';
import { generateWorkflow } from './workflow.js';

export interface BundleAgent {
  name: string;
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  systemPrompt: string;
  strategy: 'auto' | 'single-pass' | 'map-reduce';
  ciFailOn: 'never' | 'critical' | 'warning' | 'any';
  version: number;
}

export interface BundleSkill {
  slug: string;
  body: string;
}

export interface MemoryEntry {
  id: string;
  kind: string;
  scope: string;
  content: string;
  createdAt: Date;
}

/** `.devdigest/agents/<slug>.yaml`: fixed key order, validated with the runner's own schema (AC-13). */
export function buildManifestYaml(agent: BundleAgent, skillSlugs: string[]): string {
  const manifest = {
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    system_prompt: agent.systemPrompt,
    skills: skillSlugs,
    strategy: agent.strategy,
    ci_fail_on: agent.ciFailOn,
    version: agent.version,
  };
  AgentManifest.parse(manifest);
  return stringify(manifest, { lineWidth: 0 });
}

/** One `{kind, scope, content}` line per entry, oldest first; empty when there are none (AC-16). */
export function buildMemoryJsonl(entries: MemoryEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  return sorted
    .map((e) => JSON.stringify({ kind: e.kind, scope: e.scope, content: e.content }) + '\n')
    .join('');
}

export const RUNNER_MISSING_MESSAGE =
  'Runner bundle not found. Build it with `pnpm build` in agent-runner/';

/** Reads the built runner; a missing or unreadable file is a clear 400 (AC-17). */
export async function readRunner(
  path: string,
  readFile: (path: string) => Promise<string>,
): Promise<string> {
  try {
    return await readFile(path);
  } catch {
    throw new AppError('ci_runner_missing', RUNNER_MISSING_MESSAGE, 400);
  }
}

export interface BundleInput {
  agent: BundleAgent;
  agentSlug: string;
  skills: BundleSkill[];
  memory: MemoryEntry[];
  runner: string;
  triggers: CiTrigger[];
  postAs: CiPostAs;
  /** The agent's workflow file name under .github/workflows/. */
  workflowFile: string;
}

/** All files in a fixed order: manifest, skills, memory, runner, workflow. Deterministic (AC-18). */
export function buildBundle(input: BundleInput): CiFile[] {
  const file = (path: string, contents: string, editable = false): CiFile => ({ path, contents, editable });
  return [
    file(`${AGENTS_DIR}/${input.agentSlug}.yaml`, buildManifestYaml(input.agent, input.skills.map((s) => s.slug))),
    ...input.skills.map((s) => file(`${SKILLS_DIR}/${s.slug}.md`, s.body)),
    file(MEMORY_PATH, buildMemoryJsonl(input.memory)),
    file(RUNNER_PATH, input.runner),
    file(
      workflowPath(input.workflowFile),
      generateWorkflow({ triggers: input.triggers, postAs: input.postAs, slug: input.agentSlug, file: input.workflowFile }),
      true,
    ),
  ];
}

/** The wizard preview: the runner entry keeps only its size. */
export function toPreviewFiles(files: CiFile[]): CiFile[] {
  return files.map((f) =>
    f.path === RUNNER_PATH
      ? { ...f, contents: '', size_bytes: Buffer.byteLength(f.contents, 'utf8') }
      : f,
  );
}
