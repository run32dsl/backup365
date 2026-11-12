import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildApp, LOG_SERIALIZERS, REDACTED_PATHS } from './app.js';
import { createAtlasCatalog } from './atlas-sdk.js';
import { parseDataDir, parseLogLevel, parsePort, parseStorageConfig } from './config.js';
import { tryOpenSearchIndex } from './sqlite/open-search-index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';
const opened = tryOpenSearchIndex(
  join(parseDataDir(process.env['BACKUP365_DATA_DIR']), 'search.sqlite'),
);

// Une configuration partielle arrête le démarrage (l'erreur nomme les variables, sans valeur).
const storage = parseStorageConfig(process.env);
let atlas: ReturnType<typeof createAtlasCatalog> | undefined;
let atlasError: unknown;
if (storage) {
  try {
    atlas = createAtlasCatalog(storage);
  } catch (err) {
    atlasError = err;
  }
}

const app = buildApp({
  version,
  logger: {
    level: parseLogLevel(process.env['LOG_LEVEL']),
    redact: REDACTED_PATHS,
    serializers: LOG_SERIALIZERS,
  },
  ...(atlas ? { catalog: atlas.catalog } : {}),
  ...(opened.index ? { searchIndex: opened.index } : {}),
});
if (opened.error) {
  // Le code d'erreur seul : le message peut contenir un chemin local.
  const code = (opened.error as NodeJS.ErrnoException).code;
  app.log.error({ code }, 'index de recherche indisponible, /api/search répond 503');
}
if (atlasError) {
  // Le code seul : le message du SDK peut contenir une valeur de configuration.
  const { code, name } = atlasError as { code?: string; name?: string };
  app.log.error(
    { code, name },
    'catalogue Atlas indisponible, les routes du catalogue répondent 503',
  );
} else if (!storage) {
  app.log.warn('stockage non configuré, les routes du catalogue répondent 503');
}
app.addHook('onClose', async () => {
  opened.index?.close();
  await atlas?.dispose().catch(() => {
    app.log.error('libération du SDK Atlas en échec');
  });
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
