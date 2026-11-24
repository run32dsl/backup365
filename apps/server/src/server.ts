import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, LOG_SERIALIZERS, REDACTED_PATHS } from './app.js';
import { AuditAnchorer, parseAnchorIntervalMs, resolveAnchorConfig } from './audit-anchor.js';
import type { AtlasFactory } from './atlas-sdk.js';
import { startAtlas } from './atlas-startup.js';
import {
  parseDataDir,
  parseIndexIntervalMs,
  parseLogLevel,
  parseM365Config,
  parseMaxAgeHours,
  parseStatusWorkloads,
  parseStorageConfig,
  parseTrustProxy,
  withSecretFiles,
} from './config.js';
import { AuthService } from './auth.js';
import { entraEndpoints, OidcService, parseOidcConfig } from './oidc.js';
import type { SimulatedOidcProvider } from './oidc-simulated.js';
import { DriveRestoreService } from './drive-restore-service.js';
import { RestoreService } from './restore-service.js';
import { SiteRestoreService } from './site-restore-service.js';
import { PlanScheduler, executeurSimule } from './plan-scheduler.js';
import {
  AtlasExecuteur,
  createBackupInstance,
  toBackupConfig,
  type AtlasBackupApi,
  type BackupFactory,
} from './atlas-executeur.js';
import { createAtlasCatalog } from './atlas-sdk.js';
import {
  assertNoRealStorage,
  createDemoDriveRestorer,
  createDemoOidc,
  createDemoRestorer,
  createDemoSiteRestorer,
  DEMO_STORAGE,
  demoFactory,
  isDemo,
  onlyDemoAccounts,
  seedDemo,
} from './demo.js';
import { SearchIndexer } from './search-indexer.js';
import { tryOpenAccountStore } from './sqlite/open-account-store.js';
import { tryOpenAuditLog } from './sqlite/open-audit-log.js';
import { listPlanItems } from './plan-items.js';
import { tryOpenPlanStore } from './sqlite/open-plan-store.js';
import { tryOpenSearchIndex } from './sqlite/open-search-index.js';

/**
 * Assemble le serveur d'après l'environnement, sans écouter de port : c'est ce que lance l'image
 * de conteneur (`main.ts` n'ajoute que l'écoute). Une configuration partielle du stockage lève,
 * l'erreur nomme les variables manquantes, sans valeur.
 */
export function createServer(
  env: Record<string, string | undefined>,
  version: string,
  readFile: (path: string) => string,
  factory?: AtlasFactory,
  logStream?: { write(msg: string): void },
  backupFactory?: BackupFactory,
): FastifyInstance {
  const demo = isDemo(env);
  // Un seul instant pour tout le jeu de démonstration : les dates du catalogue et des plans concordent.
  const demoNow = Date.now();
  // Avant d'ouvrir quoi que ce soit : le mode démo ne se mélange jamais à un vrai stockage.
  if (demo) assertNoRealStorage(env);
  const indexIntervalMs = parseIndexIntervalMs(env['BACKUP365_INDEX_INTERVAL_MINUTES']);
  const anchorIntervalMs = parseAnchorIntervalMs(env['BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN']);
  const trustProxy = parseTrustProxy(env['BACKUP365_TRUST_PROXY']);
  const dataDir = parseDataDir(env['BACKUP365_DATA_DIR']);
  const opened = tryOpenSearchIndex(join(dataDir, 'search.sqlite'));
  const openedAudit = tryOpenAuditLog(join(dataDir, 'audit.sqlite'));
  const openedAccounts = tryOpenAccountStore(join(dataDir, 'accounts.sqlite'));
  const openedPlans = tryOpenPlanStore(join(dataDir, 'plans.sqlite'));
  const closeDatabases = (): void => {
    openedPlans.store?.close();
    opened.index?.close();
    openedAudit.audit?.close();
    openedAccounts.store?.close();
  };
  const auth = openedAccounts.store ? new AuthService({ store: openedAccounts.store }) : undefined;

  if (demo && openedAccounts.store && !onlyDemoAccounts(openedAccounts.store)) {
    closeDatabases();
    throw new Error(
      'BACKUP365_DEMO=1 refusé : le dossier de données contient des comptes réels (utiliser un BACKUP365_DATA_DIR jetable)',
    );
  }

  let startup: ReturnType<typeof startAtlas>;
  let secretEnv: Record<string, string | undefined>;
  let backup: { api: AtlasBackupApi; executeur: AtlasExecuteur } | undefined;
  let oidc: OidcService | undefined;
  let oidcSimulated: SimulatedOidcProvider | undefined;
  try {
    secretEnv = withSecretFiles(env, readFile);
    // Connexion Microsoft : désactivée tant qu'aucune variable BACKUP365_OIDC_* n'est donnée.
    if (demo) {
      const simulated = createDemoOidc();
      oidc = simulated.service;
      oidcSimulated = simulated.provider;
    } else {
      const oidcConfig = parseOidcConfig(secretEnv);
      if (oidcConfig) oidc = new OidcService(oidcConfig, entraEndpoints(oidcConfig.tenantId));
    }
    startup = demo
      ? { status: 'ready', atlas: createAtlasCatalog(DEMO_STORAGE, demoFactory(demoNow)) }
      : startAtlas(secretEnv, factory);
    // Deuxième instance du SDK, avec les identifiants Graph réels : seulement hors démo, avec un
    // stockage prêt et les deux variables BACKUP365_M365_*.
    const m365 = demo ? undefined : parseM365Config(secretEnv);
    const storage = startup.status === 'ready' && !demo ? parseStorageConfig(secretEnv) : undefined;
    if (m365 && storage && startup.status === 'ready') {
      const catalog = startup.atlas.catalog;
      let api: AtlasBackupApi | undefined;
      let refusedCode: unknown;
      try {
        api = (backupFactory ?? createBackupInstance)(toBackupConfig(storage, m365));
      } catch (err) {
        refusedCode = (err as { code?: unknown }).code;
      }
      if (!api) {
        // Le message du SDK peut citer une valeur de configuration : seul le code est gardé.
        const safe = typeof refusedCode === 'string' ? ` (${refusedCode})` : '';
        throw new Error(`Configuration Microsoft 365 refusée par le SDK${safe}`);
      }
      backup = {
        api,
        executeur: new AtlasExecuteur({
          api,
          isSite: async (id) => (await catalog.listSites()).some((site) => site.id === id),
        }),
      };
    }
  } catch (err) {
    closeDatabases();
    throw err;
  }

  const anchor = resolveAnchorConfig(
    env['BACKUP365_AUDIT_ANCHOR_DIR'],
    dataDir,
    secretEnv['BACKUP365_ENCRYPTION_PASSPHRASE'],
  );
  const anchorer =
    anchor.configured && openedAudit.audit
      ? new AuditAnchorer(openedAudit.audit, anchor.dir, anchor.key, anchorIntervalMs, (code) => {
          app.log.error({ code }, "écriture de l'ancre du journal d'audit en échec");
        })
      : undefined;

  // Dossier de l'interface construite (image de conteneur) ; sans lui, l'API seule est servie.
  const webDir = env['BACKUP365_WEB_DIR'];

  const indexer =
    startup.status === 'ready' && opened.index
      ? new SearchIndexer({
          catalog: startup.atlas.catalog,
          reader: startup.atlas.reader,
          index: opened.index,
          intervalMs: indexIntervalMs,
          // `app` existe quand le premier cycle s'exécute (hook onReady).
          logger: { error: (obj, msg) => app.log.error(obj, msg) },
        })
      : undefined;

  // Sans identifiants Microsoft 365 (hors démo), pas de planificateur : aucune exécution.
  const catalogForPlans = startup.status === 'ready' ? startup.atlas.catalog : undefined;
  const executeur = demo ? executeurSimule : backup?.executeur;
  const planScheduler =
    openedPlans.store && openedAudit.audit && executeur
      ? new PlanScheduler({
          plans: openedPlans.store,
          executeur,
          listItems: (plan) => listPlanItems(plan, catalogForPlans),
          // `app` existe quand le planificateur démarre (hook onReady).
          logger: {
            info: (obj, msg) => app.log.info(obj, msg),
            error: (obj, msg) => app.log.error(obj, msg),
          },
        })
      : undefined;

  // La restauration passe par Graph (identifiants réels), que la console n'a pas (ADR 0002) :
  // seule la démo la simule ; ailleurs elle reste non configurée (docs/adr/0012).
  const restoreService =
    demo && openedAudit.audit
      ? new RestoreService({
          restorer: createDemoRestorer(),
          audit: openedAudit.audit,
          onError: (code) => app.log.error({ code }, 'restauration : consignation en échec'),
        })
      : undefined;

  const driveRestoreService =
    demo && openedAudit.audit
      ? new DriveRestoreService({
          restorer: createDemoDriveRestorer(),
          audit: openedAudit.audit,
          onError: (code) =>
            app.log.error({ code }, 'restauration OneDrive : consignation en échec'),
        })
      : undefined;

  const siteRestoreService =
    demo && openedAudit.audit
      ? new SiteRestoreService({
          restorer: createDemoSiteRestorer(),
          audit: openedAudit.audit,
          onError: (code) =>
            app.log.error({ code }, 'restauration SharePoint : consignation en échec'),
        })
      : undefined;

  const app = buildApp({
    version,
    logger: {
      level: parseLogLevel(env['LOG_LEVEL']),
      redact: REDACTED_PATHS,
      serializers: LOG_SERIALIZERS,
      ...(logStream ? { stream: logStream } : {}),
    },
    ...(startup.status === 'ready' ? { catalog: startup.atlas.catalog } : {}),
    status: {
      auditAnchor: !anchor.configured
        ? { configured: false, reason: anchor.reason }
        : anchorer
          ? { configured: true }
          : { configured: false, reason: "journal d'audit indisponible" },
      maxAgeHours: parseMaxAgeHours(env['BACKUP365_STATUS_MAX_AGE_HOURS']),
      workloads: parseStatusWorkloads(env['BACKUP365_STATUS_WORKLOADS']),
    },
    ...(startup.status === 'ready' ? { mailContent: startup.atlas.content } : {}),
    ...(opened.index ? { searchIndex: opened.index } : {}),
    ...(openedAudit.audit ? { audit: openedAudit.audit } : {}),
    ...(auth ? { auth } : {}),
    ...(oidc ? { oidc } : {}),
    ...(oidcSimulated ? { oidcSimulated } : {}),
    ...(openedPlans.store ? { plans: openedPlans.store } : {}),
    ...(planScheduler ? { planScheduler } : {}),
    ...(restoreService ? { restore: restoreService } : {}),
    ...(startup.status === 'ready' ? { drive: startup.atlas.drive } : {}),
    ...(driveRestoreService ? { driveRestore: driveRestoreService } : {}),
    ...(startup.status === 'ready' ? { site: startup.atlas.site } : {}),
    ...(siteRestoreService ? { siteRestore: siteRestoreService } : {}),
    backupConfigured: executeur !== undefined,
    trustProxy,
    ...(demo ? { demo } : {}),
    ...(indexer ? { indexer } : {}),
    ...(webDir ? { webDir } : {}),
  });
  if (openedAudit.error) {
    const code = (openedAudit.error as NodeJS.ErrnoException).code;
    app.log.error({ code }, "journal d'audit indisponible, les routes de données répondent 503");
  }
  if (openedAccounts.error) {
    const code = (openedAccounts.error as NodeJS.ErrnoException).code;
    app.log.error({ code }, 'base des comptes indisponible, toute l’API hors santé répond 503');
  } else if (auth?.needsSetup()) {
    app.log.warn('aucun compte : ouvrir la console pour créer le compte administrateur');
  }
  if (openedPlans.error) {
    const code = (openedPlans.error as NodeJS.ErrnoException).code;
    app.log.error({ code }, 'base des plans indisponible, /api/plans répond 503');
  }
  if (!anchor.configured) {
    app.log.warn(
      `ancrage du journal : non configuré (${anchor.reason}) ; une réécriture complète ou la troncature du journal ne seraient pas détectées`,
    );
  }
  if (opened.error) {
    // Le code d'erreur seul : le message peut contenir un chemin local.
    const code = (opened.error as NodeJS.ErrnoException).code;
    app.log.error({ code }, 'index de recherche indisponible, /api/search répond 503');
  }
  if (startup.status === 'failed') {
    app.log.error(
      { code: startup.code, name: startup.name },
      'catalogue Atlas indisponible, les routes du catalogue répondent 503',
    );
  } else if (startup.status === 'unconfigured') {
    app.log.warn('stockage non configuré, les routes du catalogue répondent 503');
  }
  if (!demo && !executeur) {
    app.log.warn('sauvegarde non configurée (BACKUP365_M365_*) : aucun plan ne s’exécute');
  }
  if (demo) {
    app.log.warn('MODE DÉMO : données fictives, aucun stockage réel (comptes de démonstration)');
    app.addHook('onReady', async () => {
      if (auth) await seedDemo(auth, openedAudit.audit, demoNow, openedPlans.store);
    });
  }
  if (indexer || anchorer || planScheduler) {
    // Au démarrage de l'application, sans retarder l'écoute ni /api/health.
    app.addHook('onReady', () => {
      indexer?.start();
      anchorer?.start();
      planScheduler?.start();
    });
  }
  app.addHook('onClose', async () => {
    await indexer?.stop();
    await planScheduler?.stop();
    await backup?.api.dispose().catch(() => {
      app.log.error('libération du SDK de sauvegarde en échec');
    });
    anchorer?.stop();
    closeDatabases();
    if (startup.status === 'ready') {
      await startup.atlas.dispose().catch(() => {
        app.log.error('libération du SDK Atlas en échec');
      });
    }
  });
  return app;
}
