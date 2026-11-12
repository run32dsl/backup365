import {
  CatalogUnavailableError,
  WORKLOADS,
  type AuditLog,
  type BackupCatalog,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import { sendError } from './errors.js';

// Seule route dont l'échec est consigné : les listes de métadonnées ne passent pas par le journal.
const RESOURCE_BY_ROUTE: Record<string, string> = {
  '/api/snapshots/:id': 'snapshot',
};

const id = { type: 'string', minLength: 1, maxLength: 256 } as const;
const workload = { type: 'string', enum: [...WORKLOADS], default: 'mail' } as const;

/**
 * Routes en lecture seule du catalogue. Les listes de boîtes et d'instantanés (métadonnées) ne
 * dépendent pas du journal d'audit (ADR 0002). L'ouverture d'un instantané renvoie une fiche : sans
 * journal, elle répond 503 ; l'ouverture est consignée avant la réponse et, si la consignation
 * échoue, rien n'est renvoyé. Les échecs d'accès à cette fiche sont consignés.
 */
export function registerCatalogRoutes(
  app: FastifyInstance,
  catalog: BackupCatalog | undefined,
  audit: AuditLog | undefined,
) {
  const unavailable = { error: 'catalog_unavailable' };
  const auditMissing = { error: 'audit_unavailable' };

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof CatalogUnavailableError) {
      // Ni cause ni trace : le message du SDK peut contenir un nom de bucket.
      app.log.error({ errorName: err.name }, 'catalog unavailable');
      const resource = RESOURCE_BY_ROUTE[req.routeOptions.url ?? ''];
      if (audit && resource) await recordDenied(audit, req, resource, 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    return sendError(err, reply);
  });

  app.get('/api/mailboxes', async (_req, reply) => {
    if (!catalog) return reply.code(503).send(unavailable);
    const mailboxes = await catalog.listMailboxes();
    return { mailboxes };
  });

  app.get<{ Params: { id: string }; Querystring: { workload: (typeof WORKLOADS)[number] } }>(
    '/api/mailboxes/:id/snapshots',
    {
      schema: {
        params: { type: 'object', properties: { id }, required: ['id'] },
        querystring: { type: 'object', properties: { workload } },
      },
    },
    async (req, reply) => {
      if (!catalog) return reply.code(503).send(unavailable);
      const snapshots = await catalog.listSnapshots(req.params.id, req.query.workload);
      return { snapshots };
    },
  );

  // Fiche d'un instantané : seule « ouverture d'élément » existante, donc seul `item.open`.
  app.get<{ Params: { id: string }; Querystring: { workload: (typeof WORKLOADS)[number] } }>(
    '/api/snapshots/:id',
    {
      schema: {
        params: { type: 'object', properties: { id }, required: ['id'] },
        querystring: { type: 'object', properties: { workload } },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send(auditMissing);
      if (!catalog) {
        await recordDenied(audit, req, 'snapshot', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const detail = await catalog.getSnapshotDetail(req.query.workload, req.params.id);
      if (!detail) {
        await recordDenied(audit, req, 'snapshot', 'not_found');
        return reply.code(404).send({ error: 'snapshot_not_found' });
      }
      await audit.record(auditEvent('item.open', 'snapshot', { target: req.params.id }));
      return detail;
    },
  );
}
