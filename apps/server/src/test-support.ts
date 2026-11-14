import type { FastifyInstance } from 'fastify';
import { buildApp, type AppOptions } from './app.js';
import { AuthService } from './auth.js';
import { CSRF_HEADER, SESSION_COOKIE } from './auth-hook.js';
import type { ScryptParams } from './password.js';
import { SqliteAccountStore, type Role } from './sqlite/sqlite-account-store.js';

/** Coût minimal : les tests ne vérifient pas la robustesse de `scrypt`, seulement son usage. */
export const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1 };

export const TEST_PASSWORD = 'correct horse battery';

/** Service d'authentification en mémoire, avec une horloge réglable. */
export function testAuth(now: () => number = Date.now) {
  const store = SqliteAccountStore.open(':memory:');
  return { store, auth: new AuthService({ store, now, hashParams: CHEAP_SCRYPT }) };
}

/** Compte dont le mot de passe est `TEST_PASSWORD` (pour les tests de connexion). */
export async function addAccount(auth: AuthService, username: string, role: Role = 'operator') {
  return auth.accounts.create({ username, role, passwordHash: await auth.hash(TEST_PASSWORD) });
}

/**
 * Compte et session ouverte pour lui, sans passer par la connexion (empreinte factice : ce
 * compte ne peut pas se connecter). `headers` porte le cookie et le jeton CSRF.
 */
export function sessionFor(auth: AuthService, username: string, role: Role = 'admin') {
  const account = auth.accounts.create({ username, role, passwordHash: 'unused' });
  const { token, csrfToken } = auth.startSession(account);
  return {
    account,
    token,
    csrfToken,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, [CSRF_HEADER]: csrfToken },
  };
}

/** Ajoute ces en-têtes à chaque `inject` de l'application. */
export function withHeaders(
  app: FastifyInstance,
  headers: Record<string, string>,
): FastifyInstance {
  const inject = app.inject.bind(app) as (opts?: unknown) => unknown;
  app.inject = ((opts?: unknown) => {
    if (opts === undefined) return inject();
    const o = (typeof opts === 'string' ? { url: opts } : opts) as {
      headers?: Record<string, string>;
    };
    return inject({ ...o, headers: { ...headers, ...o.headers } });
  }) as typeof app.inject;
  return app;
}

/**
 * Application de test déjà authentifiée : un administrateur `tester` est connecté et `inject`
 * ajoute son cookie et son jeton CSRF (sauf en-têtes explicites). Pour tester l'absence de
 * session, utiliser `buildApp` directement.
 */
export function buildTestApp(
  options: AppOptions & { role?: Role; username?: string },
): FastifyInstance {
  const { auth = testAuth().auth, role, username, ...rest } = options;
  const { headers } = sessionFor(auth, username ?? 'tester', role);
  return withHeaders(buildApp({ ...rest, auth }), headers);
}
