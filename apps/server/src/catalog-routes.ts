import {
  CatalogUnavailableError,
  WORKLOADS,
  type AuditLog,
  type BackupCatalog,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';

const id = { type: 'string', minLength: 1, maxLength: 256 } as const;
const workload = { type: 'string', enum: [...WORKLOADS], default: 'mail' } as const;

/**
 * Routes en lecture seule du catalogue. Elles renvoient des éléments sauvegardés : sans journal
 * d'audit, elles répondent 503. Chaque réponse est consignée avant d'être envoyée ; si la
 * consignation échoue, rien n'est renvoyé. Sans catalogue configuré, elles répondent 503 et
 * l'échec d'accès est consigné.
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
      if (audit) await recordDenied(audit, req, 'catalog', 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    throw err;
  });

  app.get('/api/mailboxes', async (req, reply) => {
    if (!audit) return reply.code(503).send(auditMissing);
    if (!catalog) {
      await recordDenied(audit, req, 'mailboxes', 'catalog_unavailable');
      return reply.code(503).send(unavailable);
    }
    const mailboxes = await catalog.listMailboxes();
    await audit.record(auditEvent('list.view', 'mailboxes', { count: mailboxes.length }));
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
      if (!audit) return reply.code(503).send(auditMissing);
      if (!catalog) {
        await recordDenied(audit, req, 'snapshots', 'catalog_unavailable');
        return reply.code(503).send(unavailable);
      }
      const snapshots = await catalog.listSnapshots(req.params.id, req.query.workload);
      await audit.record(
        auditEvent('list.view', 'snapshots', {
          target: req.params.id,
          count: snapshots.length,
        }),
      );
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
