import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sameToken, type AuthService, type Session } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Session de l'appelant ; posée par le hook d'authentification sur toute route protégée. */
    session: (Session & { token: string }) | null;
  }
}

export const SESSION_COOKIE = 'b365_session';
export const CSRF_HEADER = 'x-csrf-token';

/** Routes d'API ouvertes sans session : santé et connexion (y compris le premier démarrage). */
export const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/setup-status',
  // Connexion Microsoft (ADR 0015) ; `demo-authorize` n'existe qu'en mode démo.
  '/api/auth/oidc/status',
  '/api/auth/oidc/login',
  '/api/auth/oidc/callback',
  '/api/auth/oidc/demo-authorize',
]);

/** Routes permises tant que le mot de passe provisoire n'a pas été changé. */
const ALLOWED_WHILE_PASSWORD_CHANGE: ReadonlySet<string> = new Set([
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/password',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Valeur du cookie `name` dans l'en-tête `Cookie`. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** `Set-Cookie` de la session : `HttpOnly`, `SameSite=Strict`, `Secure` si la requête arrive en HTTPS. */
export function sessionCookie(req: FastifyRequest, token: string, maxAgeSec?: number): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(req.protocol === 'https' ? ['Secure'] : []),
    ...(maxAgeSec === undefined ? [] : [`Max-Age=${maxAgeSec}`]),
  ].join('; ');
}

export function isApiPath(url: string): boolean {
  const raw = url.split('?')[0] ?? '';
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // Chemin illisible : on le traite tel quel, donc comme protégé s'il commence par /api.
  }
  return /^\/api(\/|$)/i.test(path) || /^\/api(\/|$)/i.test(raw);
}

/**
 * Toute route `/api/*` exige une session, sauf `PUBLIC_ROUTES` : sans session 401, mot de passe
 * provisoire non changé 403, requête qui modifie l'état sans jeton CSRF valide 403. Les routes
 * inconnues sous `/api` sont protégées aussi (401, pas 404). Sans service d'authentification
 * (base des comptes illisible), tout `/api` hors santé répond 503 : jamais d'accès ouvert.
 */
export function registerAuthHook(app: FastifyInstance, auth: AuthService | undefined): void {
  app.decorateRequest('session', null);
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const pattern = req.routeOptions.url;
    const api = (pattern?.startsWith('/api/') ?? false) || isApiPath(req.url);
    if (!api || (pattern !== undefined && PUBLIC_ROUTES.has(pattern))) return;
    if (!auth) return reply.code(503).send({ error: 'auth_unavailable' });
    const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
    const session = auth.getSession(token);
    if (!session || !token) return reply.code(401).send({ error: 'unauthenticated' });
    req.session = { ...session, token };
    if (session.mustChangePassword && !ALLOWED_WHILE_PASSWORD_CHANGE.has(pattern ?? '')) {
      return reply.code(403).send({ error: 'password_change_required' });
    }
    if (!SAFE_METHODS.has(req.method)) {
      const sent = req.headers[CSRF_HEADER];
      if (typeof sent !== 'string' || !sameToken(sent, session.csrfToken)) {
        return reply.code(403).send({ error: 'csrf_invalid' });
      }
    }
    return undefined;
  });
}
