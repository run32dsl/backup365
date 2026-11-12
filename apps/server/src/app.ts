import {
  healthResponse,
  type AuditLog,
  type BackupCatalog,
  type SearchIndex,
} from '@backup365/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerSearchRoutes } from './search-routes.js';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  /** Catalogue des sauvegardes ; absent tant que le stockage n'est pas configuré. */
  catalog?: BackupCatalog;
  /** Index de recherche des mails ; absent si la base n'est pas ouverte. */
  searchIndex?: SearchIndex;
  /** Journal d'audit ; sans lui, la recherche reste désactivée. */
  audit?: AuditLog;
}

/** Champs jamais écrits dans le journal (secrets, jetons, cookies). */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Journal des requêtes sans la chaîne de requête : elle contient les termes de recherche, qui
 * sont des données personnelles.
 */
export const LOG_SERIALIZERS = {
  req: (req: { method?: string; url?: string; id?: string }) => ({
    method: req.method,
    url: req.url?.split('?')[0],
    reqId: req.id,
  }),
};

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
export function buildApp({
  version,
  logger = false,
  catalog,
  searchIndex,
  audit,
}: AppOptions): FastifyInstance {
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
  void app.register((scope, _opts, done) => {
    registerSearchRoutes(scope, searchIndex, audit);
    done();
  });
  return app;
}
