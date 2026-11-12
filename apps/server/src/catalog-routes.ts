import { CatalogUnavailableError, WORKLOADS, type BackupCatalog } from '@backup365/core';
import type { FastifyInstance } from 'fastify';

/** Routes en lecture seule du catalogue. Sans catalogue configuré, elles répondent 503. */
export function registerCatalogRoutes(app: FastifyInstance, catalog: BackupCatalog | undefined) {
  const unavailable = { error: 'catalog_unavailable' };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof CatalogUnavailableError) {
      // Ni cause ni trace : le message du SDK peut contenir un nom de bucket.
      app.log.error({ errorName: err.name }, 'catalog unavailable');
      return reply.code(503).send(unavailable);
    }
    throw err;
  });

  app.get('/api/mailboxes', async (_req, reply) => {
    if (!catalog) return reply.code(503).send(unavailable);
    return { mailboxes: await catalog.listMailboxes() };
  });

  app.get<{ Params: { id: string }; Querystring: { workload: (typeof WORKLOADS)[number] } }>(
    '/api/mailboxes/:id/snapshots',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', minLength: 1, maxLength: 256 } },
          required: ['id'],
        },
        querystring: {
          type: 'object',
          properties: { workload: { type: 'string', enum: [...WORKLOADS], default: 'mail' } },
        },
      },
    },
    async (req, reply) => {
      if (!catalog) return reply.code(503).send(unavailable);
      return { snapshots: await catalog.listSnapshots(req.params.id, req.query.workload) };
    },
  );
}
