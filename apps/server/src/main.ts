import { createRequire } from 'node:module';
import { buildApp, REDACTED_PATHS } from './app.js';
import { parseLogLevel, parsePort } from './config.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';

const app = buildApp({
  version,
  logger: { level: parseLogLevel(process.env['LOG_LEVEL']), redact: REDACTED_PATHS },
});

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
