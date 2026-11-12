import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildApp, LOG_SERIALIZERS, REDACTED_PATHS } from './app.js';
import { parseDataDir, parseLogLevel, parsePort } from './config.js';
import { tryOpenSearchIndex } from './sqlite/open-search-index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';
const opened = tryOpenSearchIndex(
  join(parseDataDir(process.env['BACKUP365_DATA_DIR']), 'search.sqlite'),
);

const app = buildApp({
  version,
  logger: {
    level: parseLogLevel(process.env['LOG_LEVEL']),
    redact: REDACTED_PATHS,
    serializers: LOG_SERIALIZERS,
  },
  ...(opened.index ? { searchIndex: opened.index } : {}),
});
if (opened.error) {
  // Le code d'erreur seul : le message peut contenir un chemin local.
  const code = (opened.error as NodeJS.ErrnoException).code;
  app.log.error({ code }, 'index de recherche indisponible, /api/search répond 503');
}
app.addHook('onClose', () => {
  opened.index?.close();
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
