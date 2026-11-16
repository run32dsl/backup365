import type { AuditLog, SearchIndex } from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { recordDenied } from './audit-events.js';
import { cleanReason } from './mail-routes.js';
import type { RestoreService } from './restore-service.js';

interface MailParams {
  mailboxId: string;
  messageId: string;
}

const params = {
  type: 'object',
  properties: {
    mailboxId: { type: 'string', minLength: 1, maxLength: 256 },
    messageId: { type: 'string', minLength: 1, maxLength: 512 },
  },
} as const;

/**
 * Restauration d'un mail dans sa boîte d'origine (docs/adr/0012), réservée aux opérateurs et aux
 * administrateurs. `GET /api/restore` dit si la restauration est configurée ; `GET` et `POST`
 * `/api/mails/:mailboxId/:messageId/restore` donnent la dernière restauration du mail et en
 * lancent une (202, motif obligatoire, demande consignée avant le lancement).
 */
export function registerRestoreRoutes(
  app: FastifyInstance,
  index: SearchIndex | undefined,
  service: RestoreService | undefined,
  audit: AuditLog | undefined,
) {
  app.get('/api/restore', () => ({ configured: service !== undefined }));

  app.get<{ Params: MailParams }>(
    '/api/mails/:mailboxId/:messageId/restore',
    { schema: { params } },
    (req) => ({ last: service?.last(req.params.mailboxId, req.params.messageId) ?? null }),
  );

  app.post<{ Params: MailParams; Body: { reason?: unknown } | null }>(
    '/api/mails/:mailboxId/:messageId/restore',
    {
      schema: {
        params,
        body: { type: ['object', 'null'], properties: { reason: { type: 'string' } } },
      },
    },
    async (req, reply) => {
      const role = req.session?.role;
      if (role !== 'admin' && role !== 'operator') {
        if (audit) await recordDenied(audit, req, 'mail.restore', 'forbidden');
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      if (!service) return reply.code(503).send({ error: 'restore_unavailable' });
      const reason = cleanReason(req.body?.reason);
      if (reason === null) return reply.code(400).send({ error: 'reason_required' });
      const mail = index
        ? await index.getMail(req.params.mailboxId, req.params.messageId)
        : undefined;
      if (!mail) {
        await recordDenied(audit, req, 'mail.restore', 'mail_not_found');
        return reply.code(404).send({ error: 'mail_not_found' });
      }
      const job = await service.start(req.session?.username ?? 'anonymous', mail, reason);
      if (job === 'in_progress') return reply.code(409).send({ error: 'restore_in_progress' });
      return reply.code(202).send({ job });
    },
  );
}
