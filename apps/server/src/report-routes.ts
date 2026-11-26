import type { AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditEvent } from './audit-events.js';
import { EMAIL } from './graph-mailer.js';
import type { ReportService } from './report-service.js';
import {
  REPORT_FREQUENCIES,
  type ReportFrequency,
  type ReportSettings,
} from './sqlite/sqlite-report-store.js';

/** 20 destinataires au plus (maquette de #278). */
export const MAX_RECIPIENTS = 20;

const recipients = {
  type: 'array',
  maxItems: MAX_RECIPIENTS,
  items: { type: 'string', maxLength: 254, pattern: EMAIL.source },
} as const;
const frequency = { type: 'string', enum: [...REPORT_FREQUENCIES] } as const;

/** Adresses sans doublon, casse ignorée, dans l'ordre saisi. */
export function uniqueRecipients(list: readonly string[]): string[] {
  const seen = new Set<string>();
  return list.filter((address) => {
    const key = address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Rapports par mail (issue #278), réservés aux administrateurs : lire les réglages et l'état de
 * l'envoi, les enregistrer, envoyer un essai, vérifier à nouveau la permission. Les modifications
 * et les essais sont consignés au journal d'audit, avec le nombre d'adresses, jamais les adresses.
 */
export function registerReportRoutes(
  app: FastifyInstance,
  reports: ReportService | undefined,
  audit: AuditLog | undefined,
) {
  function guard(req: FastifyRequest, reply: FastifyReply) {
    if (!req.session) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (req.session.role !== 'admin') {
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (!reports) {
      void reply.code(503).send({ error: 'reports_unavailable' });
      return null;
    }
    return reports;
  }

  app.get('/api/reports', async (req, reply) => {
    const service = guard(req, reply);
    if (!service) return reply;
    return {
      settings: service.settings(),
      mailer: await service.mailerStatus(),
      lastSend: service.lastSend(),
      plans: service.planCount(),
    };
  });

  app.post('/api/reports/check', async (req, reply) => {
    const service = guard(req, reply);
    if (!service) return reply;
    return { mailer: await service.mailerStatus(true) };
  });

  app.put<{ Body: ReportSettings }>(
    '/api/reports',
    {
      schema: {
        body: {
          type: 'object',
          required: ['recipients', 'frequency', 'failureAlert'],
          additionalProperties: false,
          properties: { recipients, frequency, failureAlert: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const service = guard(req, reply);
      if (!service) return reply;
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      // Sans envoi prêt, on peut toujours vider la liste (désactiver et effacer les adresses).
      const enabling = req.body.recipients.length > 0;
      if (enabling && (await service.mailerStatus()).state !== 'ready') {
        return reply.code(409).send({ error: 'mailer_not_ready' });
      }
      const settings: ReportSettings = {
        recipients: uniqueRecipients(req.body.recipients),
        frequency: req.body.frequency,
        failureAlert: req.body.failureAlert,
      };
      // Consigné d'abord : sans trace, rien ne change.
      await audit.record(
        auditEvent(req, 'settings.update', 'reports', {
          count: settings.recipients.length,
          reason: `frequency=${settings.frequency};alert=${settings.failureAlert ? 'on' : 'off'}`,
        }),
      );
      service.save(settings);
      return { settings: service.settings() };
    },
  );

  app.post<{ Body: { recipients: string[]; frequency: ReportFrequency } }>(
    '/api/reports/test',
    {
      schema: {
        body: {
          type: 'object',
          required: ['recipients', 'frequency'],
          additionalProperties: false,
          properties: { recipients: { ...recipients, minItems: 1 }, frequency },
        },
      },
    },
    async (req, reply) => {
      const service = guard(req, reply);
      if (!service) return reply;
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      if ((await service.mailerStatus()).state !== 'ready') {
        return reply.code(409).send({ error: 'mailer_not_ready' });
      }
      if (!service.testAllowed()) return reply.code(429).send({ error: 'too_many_tests' });
      const to = uniqueRecipients(req.body.recipients);
      await audit.record(auditEvent(req, 'report.test', 'reports', { count: to.length }));
      const outcome = await service.sendTest(to, req.body.frequency);
      if (!outcome.ok) return reply.code(502).send({ error: 'send_failed', at: outcome.at });
      return { at: outcome.at, count: to.length };
    },
  );
}
