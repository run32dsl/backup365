import { createRequire } from 'node:module';
import { join } from 'node:path';
import { buildApp, LOG_SERIALIZERS, REDACTED_PATHS } from './app.js';
import { parseDataDir, parseLogLevel, parsePort } from './config.js';
import { SqliteSearchIndex } from './sqlite/sqlite-search-index.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';
const searchIndex = SqliteSearchIndex.open(
  join(parseDataDir(process.env['BACKUP365_DATA_DIR']), 'search.sqlite'),
);

const app = buildApp({
  version,
  logger: {
    level: parseLogLevel(process.env['LOG_LEVEL']),
    redact: REDACTED_PATHS,
    serializers: LOG_SERIALIZERS,
  },
  searchIndex,
});
app.addHook('onClose', () => {
  searchIndex.close();
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
