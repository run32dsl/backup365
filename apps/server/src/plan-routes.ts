import { parseProtectionPlanInput, type AuditLog } from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditEvent } from './audit-events.js';
import {
  PlanNameTakenError,
  type SqlitePlanStore,
  type StoredPlan,
} from './sqlite/sqlite-plan-store.js';

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

/** Champs modifiés, pour le journal : leurs noms seulement, jamais leurs valeurs. */
function changedFields(before: StoredPlan, after: StoredPlan): string {
  const keys = [
    'name',
    'scope',
    'selection',
    'rpoHours',
    'rtoHours',
    'retentionDays',
    'gdprJustification',
  ] as const;
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  return changed.length === 0 ? 'unchanged' : `changed:${changed.join(',')}`;
}

/**
 * Plans de protection, réservés aux administrateurs (403 sinon) : lister, créer, remplacer
 * (`PUT`), supprimer. Les entrées sont validées par `parseProtectionPlanInput` (400 avec la liste
 * des erreurs) ; un nom déjà pris donne 409. Chaque écriture est consignée (`plan.create`,
 * `plan.update`, `plan.delete`) ; sans journal ou sans base des plans, 503.
 */
export function registerPlanRoutes(
  app: FastifyInstance,
  plans: SqlitePlanStore | undefined,
  audit: AuditLog | undefined,
) {
  function guard(req: FastifyRequest, reply: FastifyReply) {
    if (!req.session) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (req.session.role !== 'admin') {
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (!plans || !audit) {
      void reply.code(503).send({ error: plans ? 'audit_unavailable' : 'plans_unavailable' });
      return null;
    }
    return { plans, audit };
  }

  const invalid = (reply: FastifyReply, errors: string[]) =>
    reply.code(400).send({ error: 'invalid_plan', message: errors.join(' '), errors });
  const taken = (reply: FastifyReply) =>
    reply.code(409).send({ error: 'plan_name_taken', message: 'Ce nom de plan existe déjà.' });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'plan_not_found' });

  app.get('/api/plans', (req, reply) => {
    const ctx = guard(req, reply);
    if (!ctx) return reply;
    return { items: ctx.plans.list() };
  });

  app.post('/api/plans', async (req, reply) => {
    const ctx = guard(req, reply);
    if (!ctx) return reply;
    const parsed = parseProtectionPlanInput(req.body);
    if (!parsed.ok) return invalid(reply, parsed.errors);
    try {
      const plan = ctx.plans.create(parsed.plan);
      await ctx.audit.record(
        auditEvent(req, 'plan.create', 'plan', {
          target: plan.id,
          reason: `scope:${plan.scope},rpo:${plan.rpoHours}`,
        }),
      );
      return await reply.code(201).send(plan);
    } catch (err) {
      if (err instanceof PlanNameTakenError) return taken(reply);
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>(
    '/api/plans/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = guard(req, reply);
      if (!ctx) return reply;
      const parsed = parseProtectionPlanInput(req.body);
      if (!parsed.ok) return invalid(reply, parsed.errors);
      try {
        const before = ctx.plans.get(req.params.id);
        const plan = before && ctx.plans.update(req.params.id, parsed.plan);
        if (!before || !plan) return notFound(reply);
        await ctx.audit.record(
          auditEvent(req, 'plan.update', 'plan', {
            target: plan.id,
            reason: changedFields(before, plan),
          }),
        );
        return plan;
      } catch (err) {
        if (err instanceof PlanNameTakenError) return taken(reply);
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/plans/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = guard(req, reply);
      if (!ctx) return reply;
      if (!ctx.plans.delete(req.params.id)) return notFound(reply);
      await ctx.audit.record(auditEvent(req, 'plan.delete', 'plan', { target: req.params.id }));
      return reply.code(204).send();
    },
  );
}
