import { healthResponse } from '@backup365/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
}

/** Champs jamais écrits dans le journal (secrets, jetons, cookies). */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/** Construit l'application Fastify, sans écouter de port. */
export function buildApp({ version, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.get('/api/health', () => healthResponse(version));
  return app;
}
