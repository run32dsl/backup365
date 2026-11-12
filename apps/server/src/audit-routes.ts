import { AUDIT_ACTIONS, type AuditAction, type AuditLog } from '@backup365/core';
import type { FastifyInstance } from 'fastify';

interface AuditQuerystring {
  from?: string;
  to?: string;
  actor?: string;
  action?: AuditAction;
  limit: number;
  offset: number;
}

const date = { type: 'string', format: 'date-time' } as const;

/** Consultation du journal d'audit (lecture seule). Sans journal configuré, elle répond 503. */
export function registerAuditRoutes(app: FastifyInstance, audit: AuditLog | undefined) {
  app.get<{ Querystring: AuditQuerystring }>(
    '/api/audit',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            from: date,
            to: date,
            actor: { type: 'string', minLength: 1, maxLength: 256 },
            action: { type: 'string', enum: [...AUDIT_ACTIONS] },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      // Le format `date-time` accepte des dates que JavaScript refuse (seconde intercalaire).
      if ([req.query.from, req.query.to].some((d) => d !== undefined && isNaN(Date.parse(d)))) {
        return reply.code(400).send({ error: 'invalid_date' });
      }
      const page = await audit.list(req.query);
      return {
        total: page.total,
        limit: req.query.limit,
        offset: req.query.offset,
        items: page.items,
      };
    },
  );
}
