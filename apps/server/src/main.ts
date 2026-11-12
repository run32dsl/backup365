import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parsePort } from './config.js';
import { createServer } from './server.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
const port = parsePort(process.env['PORT']);
const host = process.env['HOST'] ?? '127.0.0.1';

// Une configuration partielle arrête le démarrage (createServer lève, sans valeur dans l'erreur).
const app = createServer(process.env, version, (path) => readFileSync(path, 'utf8'));

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
