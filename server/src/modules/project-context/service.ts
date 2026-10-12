import type {
  AgentContextAttachments,
  ContextAttachments,
  ContextDiscovery,
  ContextSource,
  ContextDoc,
  ContextDocPreview,
  DefaultContextRepo,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError } from '../../platform/errors.js';
import {
  DISCOVERY_READ_CONCURRENCY,
  PROJECT_CONTEXT_FOLDERS,
  PROJECT_CONTEXT_MAX_DISCOVERED,
  TOKEN_CACHE_SIZE,
} from './constants.js';
import { mapLimit } from './map-limit.js';
import { decodeUtf8Strict, filterDocEntries } from './docs.js';
import { countUsedBy, effectiveDocs, validateAttachList } from './effective.js';
import { classifySource, isContextDocPath, normalizeContextPath } from './paths.js';
import type { ProjectDocsSource } from './ports.js';
import { ProjectContextRepository, type ProjectContextStore, type RepoInfo } from './repository.js';
import { TokenCache } from './token-cache.js';

export type PreviewResult =
  | { kind: 'ok'; preview: ContextDocPreview }
  | { kind: 'not_on_main' }
  | { kind: 'not_text' };

/** Fixed text: never provider messages or document content. */
export const DISCOVERY_FAILED_TEXT = 'Could not read documents from the repository';

/** Display / cap order of the source groups (AC-14). */
const SOURCE_RANK: Record<ContextSource, number> = Object.fromEntries(
  [...PROJECT_CONTEXT_FOLDERS, 'root', 'other'].map((s, i) => [s, i]),
) as Record<ContextSource, number>;

/** Authorization (404 / 403) happens before ANY source call. */
export class ProjectContextService {
  private store: ProjectContextStore;
  private tokenCache: TokenCache;

  constructor(
    private container: Container,
    store?: ProjectContextStore,
    tokenCache?: TokenCache,
  ) {
    this.store = store ?? new ProjectContextRepository(container.db);
    this.tokenCache = tokenCache ?? new TokenCache(TOKEN_CACHE_SIZE);
  }

  private async loadRepo(workspaceId: string, repoId: string): Promise<RepoInfo> {
    const repo = await this.store.findRepo(repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (repo.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);
    return repo;
  }

  private async loadAgent(workspaceId: string, id: string) {
    const agent = await this.store.findAgent(id);
    if (!agent) throw new NotFoundError('Agent not found');
    if (agent.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);
    return agent;
  }

  private async loadSkill(workspaceId: string, id: string) {
    const skill = await this.store.findSkill(id);
    if (!skill) throw new NotFoundError('Skill not found');
    if (skill.workspaceId !== workspaceId) throw new AppError('forbidden', 'Forbidden', 403);
    return skill;
  }

  async defaultRepo(workspaceId: string): Promise<DefaultContextRepo> {
    return { repo_id: await this.store.latestRepoId(workspaceId) };
  }

  /**
   * Documents at the tip of the repo's default branch. The head is resolved on every call
   * (so `refresh` and a plain read both see the new tip); only token counts are cached,
   * keyed by blob sha.
   */
  async discover(
    workspaceId: string,
    repoId: string,
    _opts: { refresh?: boolean } = {},
  ): Promise<ContextDiscovery> {
    const repo = await this.loadRepo(workspaceId, repoId);
    const ref = { owner: repo.owner, name: repo.name };
    try {
      const source = await this.container.projectDocs();
      const sha = await source.resolveBranchHead(ref, repo.defaultBranch);
      const eligible = filterDocEntries(await source.listTree(ref, sha))
        .map((e) => ({ e, rank: SOURCE_RANK[classifySource(e.path)] }))
        .sort((a, b) => a.rank - b.rank || (a.e.path < b.e.path ? -1 : a.e.path > b.e.path ? 1 : 0))
        .map((x) => x.e);
      const entries = eligible.slice(0, PROJECT_CONTEXT_MAX_DISCOVERED);
      const docs = await mapLimit(entries, DISCOVERY_READ_CONCURRENCY, async (e) => {
        let tokens = this.tokenCache.get(e.blobSha);
        if (tokens === undefined) {
          const bytes = await source.readBlob(ref, e.path, sha);
          // Lossy decode on purpose: unreadable-as-text docs are still listed.
          tokens = this.container.tokenizer.count(new TextDecoder('utf-8').decode(bytes ?? new Uint8Array()));
          this.tokenCache.set(e.blobSha, tokens);
        }
        return toDoc(e.path, tokens);
      });
      return {
        repo_id: repo.id,
        branch: repo.defaultBranch,
        commit_sha: sha,
        docs,
        total: eligible.length,
        truncated: eligible.length > entries.length,
      };
    } catch (err) {
      throw new AppError('discovery_failed', DISCOVERY_FAILED_TEXT, 502, {
        errorClass: err instanceof Error ? err.name : 'Error',
      });
    }
  }

  async preview(workspaceId: string, repoId: string, rawPath: string): Promise<PreviewResult> {
    // Authorize first (404 / 403), then validate the path (400); no source call before both.
    const repo = await this.loadRepo(workspaceId, repoId);
    const path = normalizeContextPath(rawPath);
    if (!isContextDocPath(path)) throw new AppError('invalid_path', 'Invalid document path', 400);
    const ref = { owner: repo.owner, name: repo.name };

    let source: ProjectDocsSource;
    let sha: string;
    let bytes: Uint8Array | null;
    try {
      source = await this.container.projectDocs();
      sha = await source.resolveBranchHead(ref, repo.defaultBranch);
      bytes = await source.readBlob(ref, path, sha);
    } catch (err) {
      throw new AppError('discovery_failed', DISCOVERY_FAILED_TEXT, 502, {
        errorClass: err instanceof Error ? err.name : 'Error',
      });
    }
    if (bytes === null) return { kind: 'not_on_main' };
    const content = decodeUtf8Strict(bytes);
    if (content === null) return { kind: 'not_text' };

    const usage = await this.store.workspaceUsage(workspaceId);
    return {
      kind: 'ok',
      preview: {
        path,
        source: classifySource(path),
        tokens: this.container.tokenizer.count(content),
        used_by: countUsedBy(path, usage.agents, usage.skills),
        content,
        commit_sha: sha,
      },
    };
  }

  async getAgentContext(workspaceId: string, agentId: string): Promise<AgentContextAttachments> {
    const agent = await this.loadAgent(workspaceId, agentId);
    const linked = await this.store.linkedSkillsWithPaths(agent.id);
    // Inherited = docs from linked ENABLED skills, in effective order (no agent paths).
    const inherited = effectiveDocs(
      linked.filter((s) => s.enabled),
      [],
    ).map((d) => ({ path: d.path, skill_id: d.skillId!, skill_name: d.skillName! }));
    return { paths: agent.contextPaths, version: agent.version, inherited };
  }

  async setAgentContext(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AgentContextAttachments> {
    await this.loadAgent(workspaceId, agentId);
    const valid = this.validate(paths);
    const saved = await this.store.setAgentPaths(workspaceId, agentId, valid);
    if (!saved) throw new NotFoundError('Agent not found');
    return this.getAgentContext(workspaceId, agentId);
  }

  async getSkillContext(workspaceId: string, skillId: string): Promise<ContextAttachments> {
    const skill = await this.loadSkill(workspaceId, skillId);
    return { paths: skill.contextPaths, version: skill.version };
  }

  async setSkillContext(
    workspaceId: string,
    skillId: string,
    paths: string[],
  ): Promise<ContextAttachments> {
    await this.loadSkill(workspaceId, skillId);
    const valid = this.validate(paths);
    const saved = await this.store.setSkillPaths(workspaceId, skillId, valid);
    if (!saved) throw new NotFoundError('Skill not found');
    return { paths: saved.contextPaths, version: saved.version };
  }

  private validate(paths: string[]): string[] {
    const v = validateAttachList(paths);
    if (!v.ok) {
      const [code, message] =
        v.reason === 'duplicate'
          ? ['duplicate_path', 'Duplicate document path']
          : v.reason === 'too_many'
            ? ['too_many_paths', 'Too many documents attached']
            : ['invalid_path', 'Invalid document path'];
      throw new AppError(code!, message!, 400, { path: v.path });
    }
    return v.paths;
  }
}

function toDoc(path: string, tokens: number): ContextDoc {
  const slash = path.lastIndexOf('/');
  return {
    path,
    name: path.slice(slash + 1),
    folder: path.slice(0, slash),
    source: classifySource(path),
    tokens,
  };
}
