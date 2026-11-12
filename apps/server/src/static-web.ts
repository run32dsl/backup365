import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/** Politique des pages de l'interface : scripts et styles de la console uniquement. */
export const WEB_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
  "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/**
 * Sert l'interface construite (`apps/web/dist`). Les fichiers sont lus une fois au démarrage et
 * indexés par leur chemin relatif : une URL ne peut désigner que ce qui a été indexé, donc pas de
 * remontée de dossier. Toute requête GET inconnue hors `/api` reçoit `index.html` (interface à
 * page unique) ; un `/api/*` inconnu reste un 404 JSON.
 */
export function registerWebRoutes(app: FastifyInstance, webDir: string): void {
  const files = new Map<string, { body: Buffer; type: string }>();
  for (const file of listFiles(webDir)) {
    const type = TYPES[extname(file)];
    if (type) {
      const key = '/' + relative(webDir, file).split(sep).join('/');
      files.set(key, { body: readFileSync(file), type });
    }
  }
  const index = files.get('/index.html');
  if (!index) throw new Error('BACKUP365_WEB_DIR sans index.html');
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      path === '/api' ||
      path.startsWith('/api/')
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const hit = files.get(path);
    // Un fichier absent (asset d'une ancienne version) est un 404, pas index.html.
    if (!hit && (path.startsWith('/assets/') || extname(path) !== '')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const served = hit ?? index;
    return reply.header('content-security-policy', WEB_CSP).type(served.type).send(served.body);
  });
}
