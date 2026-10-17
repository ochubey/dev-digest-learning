import type { AgentRunEstimate, LatestMultiAgentRun, MultiAgentRun } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { ESTIMATE_SAMPLE } from './constants.js';
import { estimateFromRuns } from './estimates.js';
import { buildMultiAgentRun } from './read-model.js';
import { MultiAgentRepository } from './repository.js';

export class MultiAgentService {
  private repo: MultiAgentRepository;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
  }

  async getRun(workspaceId: string, id: string): Promise<MultiAgentRun> {
    const parent = await this.repo.getParent(workspaceId, id);
    if (!parent) throw new NotFoundError('Multi-agent run not found');
    const children = await this.repo.childRuns(workspaceId, id);
    const [reviews, prNumber] = await Promise.all([
      this.repo.reviewsForRuns(workspaceId, children.map((c) => c.id)),
      this.repo.pullNumber(parent.prId),
    ]);
    return buildMultiAgentRun(parent, prNumber, children, reviews);
  }

  /** Id of the newest multi-agent run of the PR (when `prId` is given) or of the repo; null when none. */
  async latest(workspaceId: string, q: { repoId?: string; prId?: string }): Promise<LatestMultiAgentRun> {
    if (q.prId) return { id: await this.repo.latestForPr(workspaceId, q.prId, q.repoId) };
    return { id: q.repoId ? await this.repo.latestForRepo(workspaceId, q.repoId) : null };
  }

  /** Per-agent duration/cost estimate for every agent of the workspace. */
  async estimates(workspaceId: string): Promise<AgentRunEstimate[]> {
    const agents = await this.container.agentsRepo.list(workspaceId);
    return Promise.all(
      agents.map(async (a) =>
        estimateFromRuns(a.id, await this.repo.lastDoneRuns(workspaceId, a.id, ESTIMATE_SAMPLE)),
      ),
    );
  }
}
