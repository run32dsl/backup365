import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildApp, LOG_SERIALIZERS, REDACTED_PATHS } from './app.js';
import { startAtlas } from './atlas-startup.js';
import { parseDataDir, parseLogLevel, parsePort } from './config.js';
import { tryOpenAuditLog } from './sqlite/open-audit-log.js';
import { tryOpenSearchIndex } from './sqlite/open-search-index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';
const opened = tryOpenSearchIndex(
  join(parseDataDir(process.env['BACKUP365_DATA_DIR']), 'search.sqlite'),
);

const openedAudit = tryOpenAuditLog(
  join(parseDataDir(process.env['BACKUP365_DATA_DIR']), 'audit.sqlite'),
);

// Une configuration partielle arrête le démarrage (startAtlas lève, sans valeur dans l'erreur).
const startup = startAtlas(process.env);

const app = buildApp({
  version,
  logger: {
    level: parseLogLevel(process.env['LOG_LEVEL']),
    redact: REDACTED_PATHS,
    serializers: LOG_SERIALIZERS,
  },
  ...(startup.status === 'ready' ? { catalog: startup.atlas.catalog } : {}),
  ...(opened.index ? { searchIndex: opened.index } : {}),
  ...(openedAudit.audit ? { audit: openedAudit.audit } : {}),
});
if (openedAudit.error) {
  const code = (openedAudit.error as NodeJS.ErrnoException).code;
  app.log.error({ code }, "journal d'audit indisponible, les routes de données répondent 503");
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
app.addHook('onClose', async () => {
  opened.index?.close();
  openedAudit.audit?.close();
  if (startup.status === 'ready') {
    await startup.atlas.dispose().catch(() => {
      app.log.error('libération du SDK Atlas en échec');
    });
  }
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
