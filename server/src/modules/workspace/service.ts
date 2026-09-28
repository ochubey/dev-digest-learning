import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';

export interface WorkspaceSummary {
  workspaceId: string;
  cloneDir: string;
  repos: {
    id: string;
    full_name: string;
    clone_path: string | null;
    last_polled_at: string | null;
    cloned: boolean;
  }[];
}

/**
 * F1 — workspace service: where clones live + a summary of cloned repos.
 * Cleanup/re-pull of individual repos is handled by the repos module
 * (refresh/delete); this surface gives the UI an overview.
 */
export class WorkspaceService {
  constructor(private container: Container) {}

  async getSummary(workspaceId: string): Promise<WorkspaceSummary> {
    const repos = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.workspaceId, workspaceId));
    return {
      workspaceId,
      cloneDir: this.container.config.cloneDir,
      repos: repos.map((r) => ({
        id: r.id,
        full_name: r.fullName,
        clone_path: r.clonePath,
        last_polled_at: r.lastPolledAt?.toISOString() ?? null,
        cloned: Boolean(r.clonePath),
      })),
    };
  }
}
