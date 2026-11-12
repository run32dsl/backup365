import { healthResponse, type BackupCatalog } from '@backup365/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerCatalogRoutes } from './catalog-routes.js';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  /** Catalogue des sauvegardes ; absent tant que le stockage n'est pas configuré. */
  catalog?: BackupCatalog;
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
export function buildApp({ version, logger = false, catalog }: AppOptions): FastifyInstance {
  const app = Fastify({ logger, routerOptions: { maxParamLength: 512 } });
  app.addHook('onSend', (_req, reply, payload, done) => {
    void reply.headers(SECURITY_HEADERS);
    done(null, payload);
  });
  app.get('/api/health', () => healthResponse(version));
  // Plugin encapsulé : son gestionnaire d'erreurs ne touche pas le reste de l'application.
  void app.register((scope, _opts, done) => {
    registerCatalogRoutes(scope, catalog);
    done();
  });
  return app;
}
