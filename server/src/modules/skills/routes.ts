import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { SkillsService } from './service.js';
import { parseSkillImport } from './import.js';

/**
 * A1 — skills module.
 *   GET    /skills                  → list (workspace-scoped)
 *   GET    /skills/:id              → one skill
 *   POST   /skills                  → create (source='manual' default)
 *   PUT    /skills/:id              → update name/description/type/body — bumps version
 *   PATCH  /skills/:id/enabled      → toggle only, no version bump
 *   DELETE /skills/:id              → hard delete (agent_skills cascades)
 *   GET    /skills/:id/versions     → version history (newest first)
 *   POST   /skills/:id/versions/:version/restore → restore body to that version, bumps version
 *   POST   /skills/import/preview   → parse an uploaded .md or .zip (never writes to DB)
 *   POST   /skills/import           → write the (possibly edited) preview payload
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
});

const SetEnabledBody = z.object({ enabled: z.boolean() });

/**
 * Import preview accepts raw bytes as base64 rather than true multipart —
 * `@fastify/multipart` is NOT a dependency of this package (checked
 * `package.json` before implementing); adding one is out of scope for this
 * pass. The client base64-encodes the picked file's bytes client-side. Only
 * `.md` files are supported (no archive/zip library is a dependency either,
 * and none is vetted for path-traversal/symlink protection here, so archive
 * import is deliberately NOT implemented — see import.ts's doc comment).
 */
const ImportPreviewBody = z.object({
  filename: z.string().min(1),
  content_base64: z.string().min(1),
});

const ImportConfirmBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  type: SkillType,
  body: z.string().min(1),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const body = req.body;
    const skill = await service.create(workspaceId, {
      name: body.name,
      description: body.description,
      type: body.type,
      body: body.body,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.patch(
    '/skills/:id/enabled',
    { schema: { params: IdParams, body: SetEnabledBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.setEnabled(workspaceId, req.params.id, req.body.enabled);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  app.post(
    '/skills/:id/versions/:version/restore',
    { schema: { params: IdParams.extend({ version: z.coerce.number().int().positive() }) } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restoreVersion(workspaceId, req.params.id, req.params.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  // Never writes to the DB — architecturally: this handler calls no insert.
  app.post(
    '/skills/import/preview',
    { schema: { body: ImportPreviewBody } },
    async (req) => {
      await getContext(app.container, req);
      return parseSkillImport(req.body.filename, req.body.content_base64);
    },
  );

  app.post(
    '/skills/import',
    { schema: { body: ImportConfirmBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const body = req.body;
      const skill = await service.create(workspaceId, {
        name: body.name,
        description: body.description,
        type: body.type,
        body: body.body,
        source: 'imported_file',
      });
      reply.status(201);
      return skill;
    },
  );
}
