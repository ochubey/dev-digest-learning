import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AgentContextAttachments,
  ContextAttachments,
  ContextAttachmentsInput,
  ContextDiscovery,
  ContextDocPreview,
  DefaultContextRepo,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { AppError } from '../../platform/errors.js';
import { ProjectContextService } from './service.js';

const DocsQuery = z.object({ refresh: z.string().optional() });
const PreviewQuery = z.object({ path: z.string() });
const CodedError = z.object({ code: z.string(), error: z.string() });

/**
 * Project context routes (SPEC-02):
 *   GET     /context/default-repo
 *   GET     /repos/:id/context/docs[?refresh=1]       502 {code:'discovery_failed', error}
 *   GET     /repos/:id/context/docs/preview?path=     400 invalid path, 404 not_on_main, 422 not_text
 *   GET|PUT /agents/:id/context
 *   GET|PUT /skills/:id/context
 * 404 / 403 are decided before any source call; a PUT body is validated before any write.
 */
export default async function projectContextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ProjectContextService(container);

  app.get(
    '/context/default-repo',
    { schema: { response: { 200: DefaultContextRepo } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.defaultRepo(workspaceId);
    },
  );

  app.get(
    '/repos/:id/context/docs',
    {
      schema: {
        params: IdParams,
        querystring: DocsQuery,
        response: { 200: ContextDiscovery, 502: CodedError },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      try {
        return await service.discover(workspaceId, req.params.id, {
          refresh: req.query.refresh === '1',
        });
      } catch (err) {
        if (err instanceof AppError && err.code === 'discovery_failed') {
          const info = err.details as { errorClass?: string } | undefined;
          req.log.warn(
            { repoId: req.params.id, step: 'project-context', errorClass: info?.errorClass },
            'project context: discovery failed',
          );
          return reply.status(502).send({ code: 'discovery_failed', error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    '/repos/:id/context/docs/preview',
    {
      schema: {
        params: IdParams,
        querystring: PreviewQuery,
        response: { 200: ContextDocPreview, 404: z.unknown(), 422: z.unknown(), 502: CodedError },
      },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      try {
        const out = await service.preview(workspaceId, req.params.id, req.query.path);
        if (out.kind === 'not_on_main') {
          return reply.status(404).send({ code: 'not_on_main', error: 'Document is no longer on the main branch' });
        }
        if (out.kind === 'not_text') {
          return reply.status(422).send({ code: 'not_text', error: 'Document is not valid UTF-8 text' });
        }
        return out.preview;
      } catch (err) {
        if (err instanceof AppError && err.code === 'discovery_failed') {
          req.log.warn({ repoId: req.params.id, step: 'project-context' }, 'project context: preview failed');
          return reply.status(502).send({ code: 'discovery_failed', error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    '/agents/:id/context',
    { schema: { params: IdParams, response: { 200: AgentContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getAgentContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/agents/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentsInput, response: { 200: AgentContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setAgentContext(workspaceId, req.params.id, req.body.paths);
    },
  );

  app.get(
    '/skills/:id/context',
    { schema: { params: IdParams, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getSkillContext(workspaceId, req.params.id);
    },
  );

  app.put(
    '/skills/:id/context',
    { schema: { params: IdParams, body: ContextAttachmentsInput, response: { 200: ContextAttachments } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.setSkillContext(workspaceId, req.params.id, req.body.paths);
    },
  );
}
