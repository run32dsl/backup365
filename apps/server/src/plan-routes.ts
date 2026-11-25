import {
  alignCompliance,
  alignRunEnd,
  failureCauseOf,
  parseProtectionPlanInput,
  planCompliance,
  type AuditLog,
} from '@backup365/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditEvent, recordDenied } from './audit-events.js';
import { catalogRowsOf, type CatalogAccess } from './overview-routes.js';
import type { PlanScheduler } from './plan-scheduler.js';
import {
  PlanNameTakenError,
  type SqlitePlanStore,
  type StoredPlan,
} from './sqlite/sqlite-plan-store.js';

const RUNS_LIMIT = 200;
const REASON_MAX = 200;

/** Motif de lancement : texte non vide, borné ; `undefined` sinon. */
function parseReason(body: unknown): string | undefined {
  const raw = (body as { reason?: unknown } | null | undefined)?.reason;
  const reason = typeof raw === 'string' ? raw.trim() : '';
  return reason === '' || reason.length > REASON_MAX ? undefined : reason;
}

const idParams = {
  type: 'object',
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

/** Champs modifiés, pour le journal : leurs noms seulement, jamais leurs valeurs. */
function changedFields(before: StoredPlan, after: StoredPlan): string {
  const keys = [
    'name',
    'scope',
    'dataTypes',
    'selection',
    'selectionTypes',
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
 * `plan.update`, `plan.delete`) ; `GET /:id/runs` donne l'historique, `POST /:id/run` lance le
 * plan tout de suite (motif obligatoire, consigné `plan.run`) ; sans journal ou sans base des plans, 503.
 */
export function registerPlanRoutes(
  app: FastifyInstance,
  plans: SqlitePlanStore | undefined,
  audit: AuditLog | undefined,
  scheduler?: PlanScheduler,
  backupConfigured = true,
  /** Catalogue : l'état d'un plan tient compte des sauvegardes de ses sources (page « Sources »). */
  catalogAccess?: CatalogAccess,
) {
  async function guard(req: FastifyRequest, reply: FastifyReply, readOnlyOk = false) {
    if (!req.session) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (!readOnlyOk && req.session.role !== 'admin') {
      // Refus tracé quand le journal existe ; sans journal (503 plus bas), rien à écrire.
      if (audit) await recordDenied(audit, req, 'plans', 'forbidden');
      void reply.code(403).send({ error: 'forbidden' });
      return null;
    }
    if (!plans || !audit) {
      void reply.code(503).send({ error: plans ? 'audit_unavailable' : 'plans_unavailable' });
      return null;
    }
    return { plans, audit };
  }

  /** Répond une erreur et l'inscrit au journal d'audit (résultat « échec », code en motif). */
  async function refuse(
    req: FastifyRequest,
    reply: FastifyReply,
    resource: string,
    status: number,
    body: { error: string } & Record<string, unknown>,
  ) {
    if (audit) await recordDenied(audit, req, resource, body.error);
    return reply.code(status).send(body);
  }
  const invalid = (req: FastifyRequest, reply: FastifyReply, resource: string, errors: string[]) =>
    refuse(req, reply, resource, 400, {
      error: 'invalid_plan',
      message: errors.join(' '),
      errors,
    });
  const taken = (req: FastifyRequest, reply: FastifyReply, resource: string) =>
    refuse(req, reply, resource, 409, {
      error: 'plan_name_taken',
      message: 'Ce nom de plan existe déjà.',
    });
  const notFound = (req: FastifyRequest, reply: FastifyReply, resource: string) =>
    refuse(req, reply, resource, 404, { error: 'plan_not_found' });

  app.get('/api/plans', async (req, reply) => {
    // Seule route ouverte à l'opérateur (lecture seule, écran des plans).
    const ctx = await guard(req, reply, true);
    if (!ctx) return reply;
    const now = new Date();
    const rows = await catalogRowsOf(catalogAccess, req.log);
    const items = ctx.plans.list().map((plan) => {
      const runs = ctx.plans.listRuns(plan.id, RUNS_LIMIT);
      const last = runs[0];
      // L'opérateur ne reçoit que ce que la liste affiche : la sélection (la synthèse nomme les
      // boîtes), mais ni délai de remise en service ni justification.
      const visible =
        req.session?.role === 'admin'
          ? plan
          : {
              id: plan.id,
              name: plan.name,
              scope: plan.scope,
              dataTypes: plan.dataTypes,
              selection: plan.selection,
              ...(plan.selectionTypes && { selectionTypes: plan.selectionTypes }),
              rpoHours: plan.rpoHours,
              retentionDays: plan.retentionDays,
              createdAt: plan.createdAt,
            };
      return {
        ...visible,
        // Le point de restauration se lit sur tout l'historique : 200 réussites vides de suite
        // ne doivent pas faire oublier un vrai point plus ancien. Champ propre à cette route :
        // le type `Compliance` du core, partagé avec le tableau de bord, ne le porte pas.
        compliance: {
          ...alignCompliance(planCompliance(plan.rpoHours, runs, now), plan, rows),
          lastRestorePointAt: ctx.plans.lastRestorePointAt(plan.id),
        },
        running: runs.some((r) => r.status === 'running'),
        // Lancement manuel en file derrière la sauvegarde en cours : pas encore une exécution.
        queued: scheduler?.isQueued(plan.id) ?? false,
        lastRun: last
          ? {
              status: last.status,
              startedAt: last.startedAt,
              finishedAt: alignRunEnd(last, plan, rows),
              noSnapshotReason: last.noSnapshotReason,
              // Cause traduite (liste fermée), jamais le code ni le message brut.
              ...(last.status === 'failed' && { failureCause: failureCauseOf(last.error) }),
            }
          : null,
      };
    });
    return { items };
  });

  /** Les plans existent sans identifiants Microsoft 365, mais rien ne s'exécute (ADR 0009). */
  app.get('/api/plans/execution', async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return reply;
    return backupConfigured
      ? { configured: true, retention: 'not_enforced' }
      : { configured: false, label: 'sauvegarde non configurée', retention: 'not_enforced' };
  });

  app.post('/api/plans', async (req, reply) => {
    const ctx = await guard(req, reply);
    if (!ctx) return reply;
    const parsed = parseProtectionPlanInput(req.body);
    if (!parsed.ok) return invalid(req, reply, 'plan.create', parsed.errors);
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
      if (err instanceof PlanNameTakenError) return taken(req, reply, 'plan.create');
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>(
    '/api/plans/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return reply;
      const parsed = parseProtectionPlanInput(req.body);
      if (!parsed.ok) return invalid(req, reply, 'plan.update', parsed.errors);
      try {
        const before = ctx.plans.get(req.params.id);
        const plan = before && ctx.plans.update(req.params.id, parsed.plan);
        if (!before || !plan) return notFound(req, reply, 'plan.update');
        await ctx.audit.record(
          auditEvent(req, 'plan.update', 'plan', {
            target: plan.id,
            reason: changedFields(before, plan),
          }),
        );
        return plan;
      } catch (err) {
        if (err instanceof PlanNameTakenError) return taken(req, reply, 'plan.update');
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/plans/:id',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return reply;
      const reason = parseReason(req.body);
      if (reason === undefined) {
        return refuse(req, reply, 'plan.delete', 400, {
          error: 'reason_required',
          message: `Le motif de la suppression est obligatoire (${REASON_MAX} caractères au plus).`,
        });
      }
      if (!ctx.plans.delete(req.params.id)) return notFound(req, reply, 'plan.delete');
      await ctx.audit.record(
        auditEvent(req, 'plan.delete', 'plan', { target: req.params.id, reason }),
      );
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/plans/:id/runs',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return reply;
      if (!ctx.plans.get(req.params.id)) return notFound(req, reply, 'plan.runs');
      return { items: ctx.plans.listRuns(req.params.id, RUNS_LIMIT) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/plans/:id/run',
    { schema: { params: idParams } },
    async (req, reply) => {
      const ctx = await guard(req, reply);
      if (!ctx) return reply;
      const reason = parseReason(req.body);
      if (reason === undefined) {
        return refuse(req, reply, 'plan.run', 400, {
          error: 'reason_required',
          message: `Le motif du lancement est obligatoire (${REASON_MAX} caractères au plus).`,
        });
      }
      if (!backupConfigured) {
        return refuse(req, reply, 'plan.run', 503, {
          error: 'backup_not_configured',
          message: 'Sauvegarde non configurée : identifiants Microsoft 365 absents.',
        });
      }
      if (!scheduler)
        return refuse(req, reply, 'plan.run', 503, { error: 'scheduler_unavailable' });
      const plan = ctx.plans.get(req.params.id);
      if (!plan) return notFound(req, reply, 'plan.run');
      // Consigné avant le lancement : la demande est tracée même si rien ne démarre.
      await ctx.audit.record(auditEvent(req, 'plan.run', 'plan', { target: plan.id, reason }));
      let result;
      try {
        result = await scheduler.runNow(plan);
      } catch {
        return refuse(req, reply, 'plan.run', 503, { error: 'items_unavailable' });
      }
      if (result.queued) return reply.code(202).send({ started: 0, skipped: 0, queued: true });
      if (result.started === 0) {
        if (!ctx.plans.get(plan.id)) return notFound(req, reply, 'plan.run');
        const busy = result.skipped > 0;
        return refuse(req, reply, 'plan.run', 409, {
          error: busy ? 'run_in_progress' : 'no_items',
          message: busy
            ? 'Une exécution est déjà en cours sur chaque élément du plan.'
            : 'Le plan ne couvre aucun élément.',
        });
      }
      return reply
        .code(202)
        .send({ started: result.started, skipped: result.skipped, queued: false });
    },
  );
}
