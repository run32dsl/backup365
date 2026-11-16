import type { AuditEvent, AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import { sessionCookie } from './auth-hook.js';
import { passwordProblem } from './password.js';
import type { Account } from './sqlite/sqlite-account-store.js';

/** Nom d'utilisateur : 3 à 64 caractères, lettres, chiffres et `. _ @ -` (un UPN convient). */
export const USERNAME_PATTERN = '^[A-Za-z0-9._@-]{3,64}$';

export const usernameSchema = { type: 'string', pattern: USERNAME_PATTERN } as const;

const credentials = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: {
    username: { type: 'string', maxLength: 256 },
    password: { type: 'string', maxLength: 1024 },
  },
} as const;

const setupBody = {
  type: 'object',
  required: ['username', 'password'],
  additionalProperties: false,
  properties: { username: usernameSchema, password: { type: 'string', maxLength: 1024 } },
} as const;

const passwordBody = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  additionalProperties: false,
  properties: {
    currentPassword: { type: 'string', maxLength: 1024 },
    newPassword: { type: 'string', maxLength: 1024 },
  },
} as const;

function userView(account: Pick<Account, 'username' | 'role' | 'mustChangePassword' | 'oidc'>) {
  return {
    username: account.username,
    role: account.role,
    ...(account.mustChangePassword ? { mustChangePassword: true } : {}),
    ...(account.oidc ? { oidc: true } : {}),
  };
}

/**
 * Connexion, déconnexion, premier démarrage et changement de mot de passe. Les routes de
 * connexion sont publiques (auth-hook.ts) ; le reste exige la session. Sans journal d'audit, la
 * connexion et la création du premier compte répondent 503 : aucun accès sans trace.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService | undefined,
  audit: AuditLog | undefined,
) {
  const event = (
    actor: string,
    action: AuditEvent['action'],
    extra: Pick<AuditEvent, 'target' | 'reason'> = {},
  ): AuditEvent => ({ at: new Date().toISOString(), actor, action, resource: 'auth', ...extra });

  /** Consignation qui ne doit pas empêcher la réponse (échec de connexion, déconnexion). */
  async function recordSoft(req: FastifyRequest, e: AuditEvent): Promise<void> {
    try {
      await audit?.record(e);
    } catch {
      req.log.error('consignation de l’événement d’authentification en échec');
    }
  }

  function open(req: FastifyRequest, reply: FastifyReply, account: Account) {
    const { token, csrfToken } = auth!.startSession(account);
    void reply.header('set-cookie', sessionCookie(req, token));
    return { csrfToken, user: userView(account) };
  }

  app.get('/api/auth/setup-status', (_req, reply) => {
    if (!auth) return reply.code(503).send({ error: 'auth_unavailable' });
    return { needsSetup: auth.needsSetup() };
  });

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/setup',
    { schema: { body: setupBody } },
    async (req, reply) => {
      if (!auth) return reply.code(503).send({ error: 'auth_unavailable' });
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      const { username, password } = req.body;
      const problem = passwordProblem(password);
      if (problem) return reply.code(400).send({ error: problem });
      // Sans hachage (scrypt coûteux) une fois configuré : la route est publique.
      if (!auth.needsSetup()) return reply.code(409).send({ error: 'already_configured' });
      // Une seule instruction SQL : seul le premier appel crée un compte.
      const account = await auth.setup(username, password);
      if (!account) return reply.code(409).send({ error: 'already_configured' });
      await audit.record(
        event(account.username, 'account.create', {
          target: account.username,
          reason: 'first_admin',
        }),
      );
      await audit.record(event(account.username, 'auth.login'));
      return reply.code(201).send(open(req, reply, account));
    },
  );

  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    { schema: { body: credentials } },
    async (req, reply) => {
      if (!auth) return reply.code(503).send({ error: 'auth_unavailable' });
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      const { username, password } = req.body;
      const result = await auth.authenticate(username, password, req.ip);
      if (!result.ok) {
        // Le nom saisi n'est consigné que s'il désigne un compte : une faute de frappe pourrait
        // être un mot de passe. Jamais le mot de passe.
        // Les refus par le verrou ne sont consignés qu'une fois par série (le journal ne se
        // purge pas), les refus « occupé » jamais.
        if (result.reason !== 'locked' || result.firstLock) {
          await recordSoft(
            req,
            event(result.account?.username ?? 'anonymous', 'auth.login_failed', {
              reason: result.reason,
            }),
          );
        }
        if (result.reason === 'locked') {
          return reply
            .code(429)
            .header('retry-after', String(result.retryAfterSec ?? 1))
            .send({ error: 'too_many_attempts', retryAfterSec: result.retryAfterSec });
        }
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      // Fail-closed : pas de session sans trace de la connexion.
      await audit.record(event(result.account.username, 'auth.login'));
      return open(req, reply, result.account);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const session = req.session;
    if (session) {
      auth?.endSession(session.token);
      await recordSoft(req, event(session.username, 'auth.logout'));
    }
    return reply
      .header('set-cookie', sessionCookie(req, '', 0))
      .code(204)
      .send();
  });

  app.get('/api/auth/me', (req, reply) => {
    const session = req.session;
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });
    return { csrfToken: session.csrfToken, user: userView(session) };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/password',
    { schema: { body: passwordBody } },
    async (req, reply) => {
      const session = req.session;
      if (!auth || !session) return reply.code(401).send({ error: 'unauthenticated' });
      if (!audit) return reply.code(503).send({ error: 'audit_unavailable' });
      const { currentPassword, newPassword } = req.body;
      const { outcome, retryAfterSec, firstLock } = await auth.changePassword(
        session.accountId,
        session.token,
        currentPassword,
        newPassword,
      );
      if (outcome === 'wrong_password' || (outcome === 'locked' && firstLock)) {
        await recordSoft(
          req,
          event(session.username, 'auth.login_failed', {
            target: session.username,
            reason: outcome === 'locked' ? 'password_change_locked' : 'password_change_failed',
          }),
        );
      }
      if (outcome === 'locked') {
        return reply
          .code(429)
          .header('retry-after', String(retryAfterSec ?? 1))
          .send({ error: 'too_many_attempts', retryAfterSec });
      }
      if (outcome === 'wrong_password') return reply.code(403).send({ error: outcome });
      if (outcome !== 'ok') return reply.code(400).send({ error: outcome });
      await audit.record({
        at: new Date().toISOString(),
        actor: session.username,
        action: 'account.update',
        resource: 'account',
        target: session.username,
        reason: 'password_changed',
      });
      return reply.code(204).send();
    },
  );
}
