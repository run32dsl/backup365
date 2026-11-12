import {
  MailContentUnavailableError,
  type AuditLog,
  type MailContentReader,
  type SearchIndex,
} from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import { toEml, EmlError } from './eml.js';

export const MIN_REASON_LENGTH = 3;
export const MAX_REASON_LENGTH = 500;

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

/** Motif saisi : espaces de bord retirés, ni trop court ni trop long, sans caractère de contrôle. */
export function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(reason)) return null;
  return reason.length >= MIN_REASON_LENGTH && reason.length <= MAX_REASON_LENGTH ? reason : null;
}

/**
 * Fiche d'un mail indexé et export EML. Les deux lisent un élément sauvegardé : sans journal
 * d'audit elles répondent 503, et chaque réponse est consignée avant d'être envoyée (si la
 * consignation échoue, rien n'est renvoyé). L'export exige un motif, inscrit dans le journal.
 */
export function registerMailRoutes(
  app: FastifyInstance,
  index: SearchIndex | undefined,
  content: MailContentReader | undefined,
  audit: AuditLog | undefined,
) {
  const targetOf = (p: MailParams) => `${p.mailboxId}/${p.messageId}`;

  async function findMail(
    req: FastifyRequest<{ Params: MailParams }>,
    reply: FastifyReply,
    audit: AuditLog,
    resource: string,
  ) {
    if (!index) {
      await recordDenied(audit, req, resource, 'index_unavailable');
      void reply.code(503).send({ error: 'search_unavailable' });
      return null;
    }
    const mail = await index.getMail(req.params.mailboxId, req.params.messageId);
    if (!mail) {
      await recordDenied(audit, req, resource, 'mail_not_found');
      void reply.code(404).send({ error: 'mail_not_found' });
      return null;
    }
    return mail;
  }

  app.get<{ Params: MailParams }>(
    '/api/mails/:mailboxId/:messageId',
    { schema: { params } },
    async (req, reply) => {
      if (!audit) return reply.code(503).send({ error: 'search_unavailable' });
      const mail = await findMail(req, reply, audit, 'mail');
      if (!mail) return reply;
      await audit.record(auditEvent('item.open', 'mail', { target: targetOf(req.params) }));
      return mail;
    },
  );

  app.post<{ Params: MailParams; Body: { reason?: unknown } }>(
    '/api/mails/:mailboxId/:messageId/export',
    {
      schema: {
        params,
        body: { type: 'object', properties: { reason: { type: 'string' } } },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send({ error: 'search_unavailable' });
      const reason = cleanReason(req.body?.reason);
      if (reason === null) return reply.code(400).send({ error: 'reason_required' });
      const mail = await findMail(req, reply, audit, 'mail.export');
      if (!mail) return reply;
      if (!content) {
        await recordDenied(audit, req, 'mail.export', 'content_unavailable');
        return reply.code(503).send({ error: 'content_unavailable' });
      }
      let eml;
      try {
        const raw = await content.readMessage(mail.snapshotId, mail.messageId);
        if (!raw) {
          await recordDenied(audit, req, 'mail.export', 'content_not_found');
          return reply.code(404).send({ error: 'content_not_found' });
        }
        eml = toEml(raw);
      } catch (err) {
        if (err instanceof MailContentUnavailableError) {
          await recordDenied(audit, req, 'mail.export', 'content_unavailable');
          return reply.code(503).send({ error: 'content_unavailable' });
        }
        if (err instanceof EmlError) {
          await recordDenied(audit, req, 'mail.export', 'content_unsupported');
          return reply.code(422).send({ error: 'content_unsupported' });
        }
        throw err;
      }
      // Fail-closed : le motif est inscrit au journal avant que le fichier ne parte.
      await audit.record(
        auditEvent('item.export', 'mail', { target: targetOf(req.params), count: 1, reason }),
      );
      void reply
        .header('content-type', 'message/rfc822')
        .header('content-disposition', 'attachment; filename="message.eml"');
      if (eml.omittedAttachments > 0) {
        void reply.header('x-backup365-omitted-attachments', String(eml.omittedAttachments));
      }
      return reply.send(Buffer.from(eml.bytes));
    },
  );
}
