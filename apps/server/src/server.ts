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
  parseMaxAgeHours,
  parseStatusWorkloads,
  withSecretFiles,
} from './config.js';
import { SearchIndexer } from './search-indexer.js';
import { tryOpenAuditLog } from './sqlite/open-audit-log.js';
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
): FastifyInstance {
  const indexIntervalMs = parseIndexIntervalMs(env['BACKUP365_INDEX_INTERVAL_MINUTES']);
  const anchorIntervalMs = parseAnchorIntervalMs(env['BACKUP365_AUDIT_ANCHOR_INTERVAL_MIN']);
  const dataDir = parseDataDir(env['BACKUP365_DATA_DIR']);
  const opened = tryOpenSearchIndex(join(dataDir, 'search.sqlite'));
  const openedAudit = tryOpenAuditLog(join(dataDir, 'audit.sqlite'));
  const closeDatabases = (): void => {
    opened.index?.close();
    openedAudit.audit?.close();
  };

  let startup: ReturnType<typeof startAtlas>;
  let secretEnv: Record<string, string | undefined>;
  try {
    secretEnv = withSecretFiles(env, readFile);
    startup = startAtlas(secretEnv, factory);
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

  const app = buildApp({
    version,
    logger: {
      level: parseLogLevel(env['LOG_LEVEL']),
      redact: REDACTED_PATHS,
      serializers: LOG_SERIALIZERS,
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
    ...(indexer ? { indexer } : {}),
    ...(webDir ? { webDir } : {}),
  });
  if (openedAudit.error) {
    const code = (openedAudit.error as NodeJS.ErrnoException).code;
    app.log.error({ code }, "journal d'audit indisponible, les routes de données répondent 503");
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
  if (indexer || anchorer) {
    // Au démarrage de l'application, sans retarder l'écoute ni /api/health.
    app.addHook('onReady', () => {
      indexer?.start();
      anchorer?.start();
    });
  }
  app.addHook('onClose', async () => {
    await indexer?.stop();
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
