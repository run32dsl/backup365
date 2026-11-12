import type { SearchIndex } from '@backup365/core';
import type { FastifyInstance } from 'fastify';

export const MAX_PAGE_SIZE = 100;

interface SearchQuerystring {
  q?: string;
  mailbox?: string;
  from?: string;
  to?: string;
  after?: string;
  before?: string;
  limit: number;
  offset: number;
}

const text = { type: 'string', minLength: 1, maxLength: 256 } as const;
const date = { type: 'string', format: 'date-time' } as const;

/** Recherche dans l'index des mails. Sans index configuré, elle répond 503. */
export function registerSearchRoutes(app: FastifyInstance, index: SearchIndex | undefined) {
  app.get<{ Querystring: SearchQuerystring }>(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: text,
            mailbox: text,
            from: text,
            to: text,
            after: date,
            before: date,
            limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: 25 },
            offset: { type: 'integer', minimum: 0, maximum: 1_000_000, default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      if (!index) return reply.code(503).send({ error: 'search_unavailable' });
      // Le format `date-time` accepte des dates que JavaScript refuse (seconde intercalaire).
      if (
        [req.query.after, req.query.before].some((d) => d !== undefined && isNaN(Date.parse(d)))
      ) {
        return reply.code(400).send({ error: 'invalid_date' });
      }
      // Les termes recherchés sont des données personnelles : ils ne sont jamais journalisés.
      const page = await index.search(req.query);
      return {
        total: page.total,
        limit: req.query.limit,
        offset: req.query.offset,
        items: page.items,
      };
    },
  );
}
