import type { AuditLog, BackupCatalog, SearchIndex } from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { recordDenied } from './audit-events.js';
import { cleanReason } from './mail-routes.js';
import type { RestoreService, RestoreTransfer } from './restore-service.js';

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

type TransferCheck = RestoreTransfer | 'target_same' | 'target_unknown' | 'catalog_unavailable';

/**
 * Destination d'une restauration vers un autre compte (docs/adr/0024) : une boîte du catalogue,
 * différente de la source. Rien n'est supposé du client : les noms viennent du catalogue.
 */
async function checkTransfer(
  catalog: BackupCatalog | undefined,
  sourceId: string,
  targetId: string,
): Promise<TransferCheck> {
  if (targetId === sourceId) return 'target_same';
  if (!catalog) return 'catalog_unavailable';
  let mailboxes;
  try {
    mailboxes = await catalog.listMailboxes();
  } catch {
    return 'catalog_unavailable';
  }
  const target = mailboxes.find((m) => m.id === targetId);
  if (!target) return 'target_unknown';
  const source = mailboxes.find((m) => m.id === sourceId);
  return {
    sourceName: source?.displayName ?? sourceId,
    targetId,
    targetName: target.displayName,
  };
}

/**
 * Restauration d'un mail (docs/adr/0012), réservée aux opérateurs et aux administrateurs.
 * `GET /api/restore` dit si la restauration est configurée ; `GET` et `POST`
 * `/api/mails/:mailboxId/:messageId/restore` donnent la dernière restauration du mail et en
 * lancent une (202, motif obligatoire, demande consignée avant le lancement). Avec
 * `targetMailbox`, le mail est restauré dans la boîte d'un autre compte : administrateurs
 * seulement (403 `admin_required` sinon, refus consigné), destination connue du catalogue et
 * différente de la source (docs/adr/0024).
 */
export function registerRestoreRoutes(
  app: FastifyInstance,
  index: SearchIndex | undefined,
  service: RestoreService | undefined,
  audit: AuditLog | undefined,
  catalog?: BackupCatalog,
) {
  app.get('/api/restore', () => ({ configured: service !== undefined }));

  app.get<{ Params: MailParams }>(
    '/api/mails/:mailboxId/:messageId/restore',
    { schema: { params } },
    (req) => ({ last: service?.last(req.params.mailboxId, req.params.messageId) ?? null }),
  );

  app.post<{
    Params: MailParams;
    Body: { reason?: unknown; targetMailbox?: string } | null;
  }>(
    '/api/mails/:mailboxId/:messageId/restore',
    {
      schema: {
        params,
        body: {
          type: ['object', 'null'],
          properties: {
            reason: { type: 'string' },
            targetMailbox: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const role = req.session?.role;
      if (role !== 'admin' && role !== 'operator') {
        if (audit) await recordDenied(audit, req, 'mail.restore', 'forbidden');
        return reply.code(403).send({ error: 'forbidden' });
      }
      const targetId = req.body?.targetMailbox;
      if (targetId !== undefined && role !== 'admin') {
        if (audit) await recordDenied(audit, req, 'mail.restore', 'admin_required');
        return reply.code(403).send({ error: 'admin_required' });
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
      let transfer: RestoreTransfer | undefined;
      if (targetId !== undefined) {
        const checked = await checkTransfer(catalog, mail.mailboxId, targetId);
        if (typeof checked === 'string') {
          // Destination refusée : consignée comme tout refus d'une restauration.
          await recordDenied(audit, req, 'mail.restore', checked);
          return reply.code(checked === 'catalog_unavailable' ? 503 : 400).send({ error: checked });
        }
        transfer = checked;
      }
      const actor = req.session?.username ?? 'anonymous';
      const job = await service.start(actor, mail, reason, transfer);
      if (job === 'in_progress') return reply.code(409).send({ error: 'restore_in_progress' });
      return reply.code(202).send({ job });
    },
  );
}
