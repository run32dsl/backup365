import { failureCauseOf, type FailureCause } from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import {
  RUN_RESULTS,
  type RecentRun,
  type RunResult,
  type SqlitePlanStore,
} from './sqlite/sqlite-plan-store.js';

/** Page « Activités » : les 20 dernières exécutions seulement (pas de pagination, issue #258). */
export const RECENT_RUNS_LIMIT = 20;

/** Une exécution telle que l'interface la reçoit : jamais le code d'erreur brut. */
export interface RunView {
  id: number;
  planId: string;
  planName: string;
  itemId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  result: RunResult;
  itemsSaved: number | null;
  sourceBytes: number | null;
  /** Cause d'un échec ou d'une interruption, d'une liste fermée. */
  failureCause?: FailureCause;
}

export function runView(run: RecentRun): RunView {
  const result: RunResult =
    run.status === 'failed' ? (run.error === 'interrupted' ? 'interrupted' : 'failed') : run.status;
  return {
    id: run.id,
    planId: run.planId,
    planName: run.planName,
    itemId: run.itemId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: run.durationMs,
    result,
    itemsSaved: run.itemsSaved,
    sourceBytes: run.sourceBytes,
    ...(run.status === 'failed' && { failureCause: failureCauseOf(run.error) }),
  };
}

/**
 * `GET /api/runs` : dernières exécutions des plans, la plus récente en tête, filtrables par plan
 * (`planId`) et par résultat (`result`) ; `limit` (1 à 20) en réduit le nombre (5 sur l'accueil).
 * Ouvert à l'opérateur, en lecture seule comme la liste des plans. Des compteurs et des dates,
 * aucun contenu sauvegardé : hors journal d'audit (ADR 0002).
 */
export function registerRunRoutes(scope: FastifyInstance, plans: SqlitePlanStore | undefined) {
  scope.get<{ Querystring: { planId?: string; result?: RunResult; limit?: number } }>(
    '/api/runs',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            planId: { type: 'string', minLength: 1, maxLength: 64 },
            result: { type: 'string', enum: [...RUN_RESULTS] },
            limit: { type: 'integer', minimum: 1, maximum: RECENT_RUNS_LIMIT },
          },
        },
      },
    },
    async (req, reply) => {
      if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
      if (!plans) return reply.code(503).send({ error: 'plans_unavailable' });
      const { planId, result, limit = RECENT_RUNS_LIMIT } = req.query;
      const items = plans.listRecentRuns({
        ...(planId !== undefined && { planId }),
        ...(result !== undefined && { result }),
        limit,
      });
      return { items: items.map(runView), limit };
    },
  );
}
