import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiAgentView,
  CiExport,
  CiExportInput,
  CiPreview,
  CiRunsList,
  CiSyncResult,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConfigError } from '../../platform/errors.js';
import { OctokitActionsSource } from '../../adapters/github-actions/octokit.js';
import { CI_EXPORT_RATE_LIMIT, RUNNER_BUNDLE_PATH } from './constants.js';
import { CiRepository } from './repository.js';
import { CiService } from './service.js';

/**
 * Export-to-CI routes (SPEC-05):
 *   POST /agents/:id/export-ci/preview   bundle preview (runner without contents)
 *   POST /agents/:id/export-ci           open a PR, or return a zip
 *   GET  /agents/:id/ci                  installations + recent runs
 *   GET  /ci/runs                        newest runs of the workspace
 *   POST /ci/sync                        pull + ingest new Actions runs (no body)
 * No route accepts an artifact body: results enter only through `sync`, which reads GitHub.
 */
export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  const serviceFor = (req: { log: { info(m: string): void; warn(m: string): void } }) =>
    new CiService({
      repo: new CiRepository(container.db),
      github: () => container.github(),
      actions: async () => {
        const token = await container.secrets.get('GITHUB_TOKEN');
        if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
        return new OctokitActionsSource(token);
      },
      runnerPath: RUNNER_BUNDLE_PATH,
      readFile: (p) => readFile(p, 'utf8'),
      log: { info: (m) => req.log.info(m), warn: (m) => req.log.warn(m) },
    });

  app.post(
    '/agents/:id/export-ci/preview',
    { schema: { params: IdParams, body: CiExportInput, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return serviceFor(req).preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } },
      config: { rateLimit: CI_EXPORT_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return serviceFor(req).export(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/agents/:id/ci',
    { schema: { params: IdParams, response: { 200: CiAgentView } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return serviceFor(req).agentView(workspaceId, req.params.id);
    },
  );

  app.get('/ci/runs', { schema: { response: { 200: CiRunsList } } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return serviceFor(req).listRuns(workspaceId);
  });

  // AC-57: no payload is accepted; any body answers 422.
  app.post(
    '/ci/sync',
    { schema: { body: z.object({}).strict().optional(), response: { 200: CiSyncResult } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return serviceFor(req).sync(workspaceId);
    },
  );
}
