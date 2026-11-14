import type { AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.js';
import { usernameSchema } from './auth-routes.js';
import { passwordProblem } from './password.js';
import {
  LastAdminError,
  ROLES,
  UsernameTakenError,
  publicAccount,
  type Role,
} from './sqlite/sqlite-account-store.js';

const idParams = {
  type: 'object',
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

const role = { type: 'string', enum: [...ROLES] } as const;

/**
 * Gestion des comptes, réservée aux administrateurs (403 sinon) : lister, créer, désactiver,
 * changer de rôle, réinitialiser le mot de passe. Chaque changement est consigné. Le dernier
 * administrateur actif ne peut être ni désactivé ni rétrogradé (409).
 */
export function registerAccountRoutes(
  app: FastifyInstance,
  auth: AuthService | undefined,
  audit: AuditLog | undefined,
) {
  /** Contrôles communs : session administrateur, service d'authentification et journal présents. */
  function guard(req: FastifyRequest, reply: FastifyReply) {
    const session = req.session;
    if (!auth || !session) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (session.role !== 'admin') {
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (!audit) {
      void reply.code(503).send({ error: 'audit_unavailable' });
      return null;
    }
    return { auth, audit, actor: session.username };
  }

  const record = (
    ctx: { audit: AuditLog; actor: string },
    target: string,
    action: 'account.create' | 'account.update',
    reason: string,
  ) =>
    ctx.audit.record({
      at: new Date().toISOString(),
      actor: ctx.actor,
      action,
      resource: 'account',
      target,
      reason,
    });

  app.get('/api/accounts', (req, reply) => {
    const ctx = guard(req, reply);
    if (!ctx) return reply;
    return { items: ctx.auth.accounts.list().map(publicAccount) };
  });

  app.post<{ Body: { username: string; password: string; role: Role } }>(
    '/api/accounts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password', 'role'],
          additionalProperties: false,
          properties: {
            username: usernameSchema,
            password: { type: 'string', maxLength: 1024 },
            role,
          },
        },
      },
    },
    async (req, reply) => {
      const ctx = guard(req, reply);
      if (!ctx) return reply;
      const { username, password } = req.body;
      const problem = passwordProblem(password);
      if (problem) return reply.code(400).send({ error: problem });
      try {
        // Mot de passe provisoire choisi par l'administrateur : à changer à la première connexion.
        const account = ctx.auth.accounts.create({
          username,
          role: req.body.role,
          passwordHash: await ctx.auth.hash(password),
          mustChangePassword: true,
        });
        await record(ctx, account.username, 'account.create', `role:${account.role}`);
        return reply.code(201).send(publicAccount(account));
      } catch (err) {
        if (err instanceof UsernameTakenError) {
          return reply.code(409).send({ error: 'username_taken' });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: number }; Body: { role?: Role; disabled?: boolean } }>(
    '/api/accounts/:id',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          additionalProperties: false,
          minProperties: 1,
          properties: { role, disabled: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      const ctx = guard(req, reply);
      if (!ctx) return reply;
      try {
        const account = ctx.auth.accounts.update(req.params.id, req.body);
        if (!account) return reply.code(404).send({ error: 'account_not_found' });
        const changes = [
          ...(req.body.role === undefined ? [] : [`role:${req.body.role}`]),
          ...(req.body.disabled === undefined ? [] : [`disabled:${String(req.body.disabled)}`]),
        ];
        // Un compte désactivé perd ses sessions tout de suite (getSession relit aussi la base).
        if (account.disabled) ctx.auth.revokeAccount(account.id);
        await record(ctx, account.username, 'account.update', changes.join(','));
        return publicAccount(account);
      } catch (err) {
        if (err instanceof LastAdminError) {
          return reply.code(409).send({ error: 'last_admin' });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: number }; Body: { password: string } }>(
    '/api/accounts/:id/reset-password',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['password'],
          additionalProperties: false,
          properties: { password: { type: 'string', maxLength: 1024 } },
        },
      },
    },
    async (req, reply) => {
      const ctx = guard(req, reply);
      if (!ctx) return reply;
      const problem = passwordProblem(req.body.password);
      if (problem) return reply.code(400).send({ error: problem });
      const account = await ctx.auth.resetPassword(req.params.id, req.body.password);
      if (!account) return reply.code(404).send({ error: 'account_not_found' });
      await record(ctx, account.username, 'account.update', 'password_reset');
      return reply.code(204).send();
    },
  );
}
