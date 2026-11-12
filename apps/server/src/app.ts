import {
  DEFAULT_MAX_AGE_HOURS,
  healthResponse,
  type AuditLog,
  type BackupCatalog,
  type MailContentReader,
  type SearchIndex,
} from '@backup365/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAuditRoutes } from './audit-routes.js';
import { sendError } from './errors.js';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerMailRoutes } from './mail-routes.js';
import type { SearchIndexer } from './search-indexer.js';
import { registerSearchRoutes } from './search-routes.js';
import { registerWebRoutes } from './static-web.js';
import { registerStatusRoutes, type StatusOptions } from './status-routes.js';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
  /** Catalogue des sauvegardes ; absent tant que le stockage n'est pas configuré. */
  catalog?: BackupCatalog;
  /** Index de recherche des mails ; absent si la base n'est pas ouverte. */
  searchIndex?: SearchIndex;
  /** Lecture du contenu des mails (export EML) ; absente tant que le stockage n'est pas configuré. */
  mailContent?: MailContentReader;
  /** Journal d'audit ; sans lui, les routes qui renvoient des éléments sauvegardés répondent 503. */
  audit?: AuditLog;
  /** Indexation en arrière-plan ; son état figure dans `/api/status`. */
  indexer?: SearchIndexer;
  /** Seuil et charges du tableau de bord ; 26 h, mail et OneDrive par défaut. */
  status?: StatusOptions;
  /** Dossier de l'interface construite ; sans lui, seule l'API répond. */
  webDir?: string;
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
  mailContent,
  audit,
  indexer,
  status = { maxAgeHours: DEFAULT_MAX_AGE_HOURS, workloads: ['mail', 'onedrive', 'sharepoint'] },
  webDir,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger, routerOptions: { maxParamLength: 512 } });
  app.addHook('onSend', (_req, reply, payload, done) => {
    // La politique propre aux pages de l'interface (static-web.ts) l'emporte sur celle de l'API.
    const own = reply.getHeader('content-security-policy');
    void reply.headers(
      own ? { ...SECURITY_HEADERS, 'content-security-policy': own } : SECURITY_HEADERS,
    );
    done(null, payload);
  });
  // Aucun message d'erreur interne (moteur SQLite, chemin) ne sort : 500 générique.
  app.setErrorHandler((err, _req, reply) => sendError(err, reply));
  app.get('/api/health', () => healthResponse(version));
  // Plugin encapsulé : son gestionnaire d'erreurs ne touche pas le reste de l'application.
  void app.register((scope, _opts, done) => {
    registerCatalogRoutes(scope, catalog, audit);
    registerStatusRoutes(scope, catalog, status, { index: searchIndex, indexer });
    done();
  });
  void app.register((scope, _opts, done) => {
    registerAuditRoutes(scope, audit);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerSearchRoutes(scope, searchIndex, audit);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerMailRoutes(scope, searchIndex, mailContent, audit);
    done();
  });
  if (webDir) registerWebRoutes(app, webDir);
  return app;
}
