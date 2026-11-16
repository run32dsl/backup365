import type { AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import { cookieValue, sessionCookie } from './auth-hook.js';
import { sameToken } from './auth.js';
import {
  OIDC_CALLBACK_PATH,
  OidcError,
  type OidcFailure,
  type OidcIdentity,
  type OidcService,
} from './oidc.js';
import type { SimulatedOidcProvider } from './oidc-simulated.js';
import {
  LastAdminError,
  UsernameTakenError,
  type AccountRecord,
} from './sqlite/sqlite-account-store.js';

export const OIDC_COOKIE = 'b365_oidc';
const FLOW_MAX_AGE_SEC = 600;

/**
 * Compte local de cette identité : créé à la première connexion, rôle relu des groupes à chaque
 * connexion. Un compte désactivé reste refusé ; un nom déjà pris par un autre compte (local) est
 * refusé aussi, sans fusion : un compte local ne peut pas être repris par un nom Entra.
 */
export function provisionOidcAccount(auth: AuthService, identity: OidcIdentity): AccountRecord {
  const store = auth.accounts;
  const known = store.findByOidcSubject(identity.subject);
  if (known) {
    if (known.disabled) throw new OidcError('disabled', known.username);
    if (known.role === identity.role) return known;
    try {
      return store.update(known.id, { role: identity.role }) ?? known;
    } catch (err) {
      // Le dernier administrateur actif garde son rôle : jamais de console sans administrateur.
      if (err instanceof LastAdminError) return known;
      throw err;
    }
  }
  try {
    return store.createOidc(identity);
  } catch (err) {
    if (err instanceof UsernameTakenError)
      throw new OidcError('account_conflict', identity.username);
    throw err;
  }
}

/** Cookie qui lie le `state` au navigateur qui a démarré la connexion (contre le login CSRF). */
function flowCookie(req: FastifyRequest, value: string, maxAgeSec: number): string {
  return [
    `${OIDC_COOKIE}=${value}`,
    'Path=/api/auth/oidc',
    'HttpOnly',
    // Lax : le retour de Microsoft est une navigation d'un autre site, que Strict priverait du cookie.
    'SameSite=Lax',
    ...(req.protocol === 'https' ? ['Secure'] : []),
    `Max-Age=${maxAgeSec}`,
  ].join('; ');
}

const callbackQuery = {
  type: 'object',
  properties: {
    code: { type: 'string', maxLength: 4096 },
    state: { type: 'string', maxLength: 256 },
    error: { type: 'string', maxLength: 256 },
  },
} as const;

/**
 * Connexion avec un compte Microsoft (ADR 0015). Absente (`oidc` indéfini) : l'état est
 * `enabled: false` et les autres routes répondent 404 ; les comptes locaux ne changent pas.
 */
export function registerOidcRoutes(
  app: FastifyInstance,
  auth: AuthService | undefined,
  audit: AuditLog | undefined,
  oidc: OidcService | undefined,
  simulated?: SimulatedOidcProvider,
) {
  app.get('/api/auth/oidc/status', () => ({ enabled: oidc !== undefined }));

  if (simulated) {
    // Mode démo : l'« écran Microsoft » est cette route, qui accorde le consentement sans saisie.
    app.get('/api/auth/oidc/demo-authorize', (req, reply) => {
      const granted = simulated.authorize(req.url);
      if (!granted) return reply.code(400).send({ error: 'bad_request' });
      const query = new URLSearchParams(granted).toString();
      return reply.redirect(`${OIDC_CALLBACK_PATH}?${query}`, 302);
    });
  }

  app.get('/api/auth/oidc/login', (req, reply) => {
    if (!oidc) return reply.code(404).send({ error: 'oidc_disabled' });
    if (!auth) return reply.code(503).send({ error: 'auth_unavailable' });
    if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
    const { url, state } = oidc.start();
    return reply.header('set-cookie', flowCookie(req, state, FLOW_MAX_AGE_SEC)).redirect(url, 302);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/oidc/callback',
    { schema: { querystring: callbackQuery } },
    async (req, reply) => {
      const back = (code: OidcFailure | 'unavailable') =>
        reply.header('set-cookie', flowCookie(req, '', 0)).redirect(`/?oidc_error=${code}`, 302);
      if (!oidc) return reply.code(404).send({ error: 'oidc_disabled' });
      if (!auth || !audit) return back('unavailable');
      const { code, state, error } = req.query;
      const bound = cookieValue(req.headers.cookie, OIDC_COOKIE);
      // État inconnu ou cookie d'un autre navigateur : rien n'est consommé ni contacté.
      if (!state || !bound || !sameToken(bound, state) || !oidc.knows(state)) {
        return back('invalid_request');
      }
      try {
        if (error || !code) {
          // Refus de l'utilisateur ou du fournisseur : l'état est brûlé.
          oidc.cancel(state);
          return back('provider_error');
        }
        const identity = await oidc.finish(code, state);
        const account = provisionOidcAccount(auth, identity);
        // Fail-closed : pas de session sans trace de la connexion.
        try {
          await audit.record({
            at: new Date().toISOString(),
            actor: account.username,
            action: 'auth.login',
            resource: 'auth',
            reason: 'oidc',
          });
        } catch {
          req.log.error('consignation de la connexion Microsoft en échec');
          return back('unavailable');
        }
        const { token } = auth.startSession(account);
        return reply
          .header('set-cookie', [sessionCookie(req, token), flowCookie(req, '', 0)])
          .redirect('/', 302);
      } catch (err) {
        if (!(err instanceof OidcError)) throw err;
        if (err.code === 'no_group' && err.subject) {
          // Plus de groupe reconnu : les sessions ouvertes de ce compte se ferment aussi.
          const known = auth.accounts.findByOidcSubject(err.subject);
          if (known) auth.revokeAccount(known.id);
        }
        // Seule une identité vérifiée (signature comprise) est consignée : un appel sans jeton
        // valide ne doit pas faire grossir le journal, qui ne se purge pas.
        if (err.username) {
          try {
            await audit.record({
              at: new Date().toISOString(),
              actor: err.username,
              action: 'auth.login_failed',
              resource: 'auth',
              reason: `oidc_${err.code}`,
            });
          } catch {
            req.log.error('consignation du refus de connexion Microsoft en échec');
          }
        } else {
          req.log.warn({ code: err.code }, 'connexion Microsoft refusée');
        }
        return back(err.code);
      }
    },
  );
}
