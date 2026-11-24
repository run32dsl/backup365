import type { AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { recordDenied } from './audit-events.js';
import { isApiPath } from './auth-hook.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Hôte (avec port) de l'en-tête `Origin`, ou `null` s'il est illisible ou opaque (`null`). */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Vrai si la requête d'écriture vient d'une autre origine : `Sec-Fetch-Site: cross-site`, ou
 * `Origin` présent dont l'hôte diffère de celui de la requête. `req.host` tient compte de
 * `X-Forwarded-Host` uniquement si `BACKUP365_TRUST_PROXY` désigne le proxy. Sans ces en-têtes
 * (clients non navigateurs), la requête passe : le cookie `SameSite=Strict` et le jeton CSRF restent.
 */
export function isCrossOrigin(req: FastifyRequest): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (origin === undefined) return false;
  return originHost(origin) !== req.host.toLowerCase();
}

/**
 * Défense en profondeur : refuse (403 `cross_origin`) toute écriture sur `/api/` venue d'une autre
 * origine, avant l'authentification, et l'inscrit au journal d'audit. Le rappel OIDC est un GET
 * (redirection du navigateur) : il n'est pas concerné.
 */
export function registerOriginGuard(app: FastifyInstance, audit: AuditLog | undefined): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!WRITE_METHODS.has(req.method) || !isApiPath(req.url)) return undefined;
    if (!isCrossOrigin(req)) return undefined;
    req.log.warn(
      { route: req.routeOptions.url ?? 'unmatched', method: req.method },
      'requête d’écriture refusée : autre origine',
    );
    if (audit) await recordDenied(audit, req, 'api.write', 'cross_origin');
    return reply.code(403).send({ error: 'cross_origin' });
  });
}
