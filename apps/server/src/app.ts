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

/** En-têtes de sécurité posés sur chaque réponse. */
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};

/** Construit l'application Fastify, sans écouter de port. */
export function buildApp({ version, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.addHook('onSend', (_req, reply, payload, done) => {
    void reply.headers(SECURITY_HEADERS);
    done(null, payload);
  });
  app.get('/api/health', () => healthResponse(version));
  return app;
}
