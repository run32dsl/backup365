import {
  DEFAULT_MAX_AGE_HOURS,
  healthResponse,
  type AuditLog,
  type BackupCatalog,
  type DriveBrowser,
  type MailContentReader,
  type SearchIndex,
  type SiteBrowser,
} from '@backup365/core';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAccountRoutes } from './account-routes.js';
import type { AuthService } from './auth.js';
import { registerAuthHook } from './auth-hook.js';
import { registerOriginGuard } from './origin-guard.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerAuditRoutes } from './audit-routes.js';
import { sendError } from './errors.js';
import type { OidcService } from './oidc.js';
import { registerOidcRoutes } from './oidc-routes.js';
import type { SimulatedOidcProvider } from './oidc-simulated.js';
import { registerCatalogRoutes } from './catalog-routes.js';
import { registerConfigurationRoutes } from './configuration-routes.js';
import { registerMailRoutes } from './mail-routes.js';
import type { DriveRestoreService } from './drive-restore-service.js';
import { registerOneDriveRoutes } from './onedrive-routes.js';
import { registerSharePointRoutes } from './sharepoint-routes.js';
import type { SiteRestoreService } from './site-restore-service.js';
import { registerRestoreRoutes } from './restore-routes.js';
import type { RestoreService } from './restore-service.js';
import { registerPlanRoutes } from './plan-routes.js';
import { registerReportRoutes } from './report-routes.js';
import type { ReportService } from './report-service.js';
import { registerRunRoutes } from './run-routes.js';
import type { PlanScheduler } from './plan-scheduler.js';
import { registerRetentionRoutes } from './retention-routes.js';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';
import type { SearchIndexer } from './search-indexer.js';
import { registerSearchRoutes } from './search-routes.js';
import { registerWebRoutes } from './static-web.js';
import { registerOverviewRoutes } from './overview-routes.js';
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
  /**
   * Comptes locaux et sessions. Absent (base des comptes illisible), toute l'API hors santé
   * répond 503 : jamais d'accès sans authentification.
   */
  auth?: AuthService;
  /** Connexion avec un compte Microsoft ; absente (configuration absente), seuls les comptes locaux entrent. */
  oidc?: OidcService;
  /** Fournisseur simulé du mode démo : expose son écran d'autorisation. */
  oidcSimulated?: SimulatedOidcProvider;
  /** Plans de protection ; absent si la base des plans est illisible (`/api/plans` répond 503). */
  plans?: SqlitePlanStore;
  /** Planificateur des plans ; absent, `POST /api/plans/:id/run` répond 503. */
  planScheduler?: PlanScheduler;
  /** Rapports par mail (issue #278) ; absents si leur base est illisible (503). */
  reports?: ReportService;
  /** Restauration de mails ; absente, elle n'est pas configurée (503, bouton désactivé). */
  restore?: RestoreService;
  /** Parcours des OneDrive sauvegardés ; absent tant que le stockage n'est pas configuré. */
  drive?: DriveBrowser;
  /** Restauration de fichiers OneDrive ; absente, elle n'est pas configurée (503, boutons désactivés). */
  driveRestore?: DriveRestoreService;
  /** Parcours des sites SharePoint sauvegardés ; absent tant que le stockage n'est pas configuré. */
  site?: SiteBrowser;
  /** Restauration SharePoint ; absente, elle n'est pas configurée (503, boutons désactivés). */
  siteRestore?: SiteRestoreService;
  /** Sauvegarde réelle configurée (identifiants Microsoft 365) ? Faux : aucun plan ne s'exécute (ADR 0009). */
  backupConfigured?: boolean;
  /** Derrière un proxy inverse de confiance : `X-Forwarded-Proto` et `-For` sont lus (cookie `Secure`, IP). */
  trustProxy?: string | false;
  /** Dossier de l'interface construite ; sans lui, seule l'API répond. */
  webDir?: string;
  /** Mode démo : `/api/health` l'annonce, l'interface affiche un bandeau. */
  demo?: boolean;
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
  auth,
  oidc,
  oidcSimulated,
  plans,
  planScheduler,
  reports,
  restore,
  drive,
  driveRestore,
  site,
  siteRestore,
  backupConfigured = true,
  trustProxy = false,
  indexer,
  status = { maxAgeHours: DEFAULT_MAX_AGE_HOURS, workloads: ['mail', 'onedrive', 'sharepoint'] },
  webDir,
  demo = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    trustProxy,
    // UUID natif : unique d'un redémarrage à l'autre (le compteur `req-N` repartait de 1).
    genReqId: () => randomUUID(),
    routerOptions: { maxParamLength: 512 },
  });
  app.addHook('onSend', (_req, reply, payload, done) => {
    // La politique propre aux pages de l'interface (static-web.ts) l'emporte sur celle de l'API.
    const own = reply.getHeader('content-security-policy');
    void reply.headers(
      own ? { ...SECURITY_HEADERS, 'content-security-policy': own } : SECURITY_HEADERS,
    );
    done(null, payload);
  });
  // Toute réponse d'erreur de l'API est journalisée et porte l'identifiant de requête, que
  // l'interface affiche pour le support. Ni corps de requête ni contenu : le code métier seul.
  app.addHook('onSend', (req, reply, payload, done) => {
    const status = reply.statusCode;
    if (status < 400 || !req.url.startsWith('/api/')) return done(null, payload);
    let body: Record<string, unknown> | undefined;
    if (typeof payload === 'string') {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = undefined;
      }
    }
    const code = typeof body?.error === 'string' ? body.error : undefined;
    const entry = {
      route: req.routeOptions.url ?? 'unmatched',
      method: req.method,
      status,
      code,
      reqId: req.id,
      user: req.session?.username ?? 'anonymous',
    };
    if (status >= 500) req.log.error(entry, 'action en erreur');
    else req.log.warn(entry, 'action refusée');
    void reply.header('x-request-id', req.id);
    done(null, payload);
  });
  // Aucun message d'erreur interne (moteur SQLite, chemin) ne sort : 500 générique.
  app.setErrorHandler((err, _req, reply) => sendError(err, reply));
  registerOriginGuard(app, audit);
  registerAuthHook(app, auth);
  app.get('/api/health', () => healthResponse(version, demo));
  void app.register((scope, _opts, done) => {
    registerAuthRoutes(scope, auth, audit);
    registerOidcRoutes(scope, auth, audit, oidc, oidcSimulated);
    registerAccountRoutes(scope, auth, audit);
    done();
  });
  // Plugin encapsulé : son gestionnaire d'erreurs ne touche pas le reste de l'application.
  void app.register((scope, _opts, done) => {
    registerCatalogRoutes(scope, catalog, audit);
    registerStatusRoutes(scope, catalog, status, { index: searchIndex, indexer, plans });
    done();
  });
  void app.register((scope, _opts, done) => {
    registerOverviewRoutes(scope, plans, planScheduler, {
      catalog,
      maxAgeHours: status.maxAgeHours,
      workloads: status.workloads,
    });
    registerConfigurationRoutes(scope, { backupConfigured, workloads: status.workloads });
    registerReportRoutes(scope, reports, audit);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerPlanRoutes(scope, plans, audit, planScheduler, backupConfigured, {
      catalog,
      maxAgeHours: status.maxAgeHours,
      workloads: status.workloads,
    });
    registerRetentionRoutes(scope, plans, catalog, audit);
    registerRunRoutes(scope, plans);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerAuditRoutes(scope, audit, searchIndex, catalog);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerSearchRoutes(scope, searchIndex, audit);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerMailRoutes(scope, searchIndex, mailContent, audit);
    registerRestoreRoutes(scope, searchIndex, restore, audit, catalog);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerOneDriveRoutes(scope, drive, driveRestore, audit);
    done();
  });
  void app.register((scope, _opts, done) => {
    registerSharePointRoutes(scope, catalog, site, siteRestore, audit);
    done();
  });
  if (webDir) registerWebRoutes(app, webDir);
  return app;
}
