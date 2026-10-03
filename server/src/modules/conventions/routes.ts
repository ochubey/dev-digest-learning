import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { ConventionsService } from './service.js';

/**
 * Conventions module — repo-scoped extraction of coding conventions into
 * reviewable candidates, and folding accepted ones into a new skill.
 *
 *   POST /repos/:id/conventions/extract       → run the extraction pipeline
 *   GET  /repos/:id/conventions               → list candidates (any status)
 *   PATCH /conventions/:id                    → accept | reject | edit
 *   POST /repos/:id/conventions/create-skill  → fold accepted candidates into a skill
 */

const PatchConventionBody = z.object({
  action: z.enum(['accept', 'reject', 'edit']),
  rule: z.string().min(1).optional(),
  category: z.string().optional(),
  evidence_path: z.string().optional(),
  evidence_snippet: z.string().optional(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().default(''),
  candidate_ids: z.array(z.string()).min(1),
  /** Editable skill body from the create-skill modal (rubric #41); falls
   *  back to the auto-concatenated rule list server-side when omitted. */
  body: z.string().optional(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.post(
    '/repos/:id/conventions/extract',
    { schema: { params: IdParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const candidates = await service.extract(workspaceId, req.params.id);
      reply.status(201);
      return candidates;
    },
  );

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: PatchConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const { action, ...edit } = req.body;
      return service.patch(workspaceId, req.params.id, action, edit);
    },
  );

  app.post(
    '/repos/:id/conventions/create-skill',
    { schema: { params: IdParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, {
        name: req.body.name,
        description: req.body.description,
        candidateIds: req.body.candidate_ids,
        body: req.body.body,
      });
      reply.status(201);
      return skill;
    },
  );
}
