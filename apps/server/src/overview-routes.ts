import type { FastifyInstance } from 'fastify';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

/** Exécutions relues par plan : la dernière réussite se trouve parmi les plus récentes. */
const RUNS_LIMIT = 500;

export type BackupOverviewState = 'operational' | 'unconfigured' | 'pending' | 'failed';

export interface Overview {
  /**
   * `unconfigured` : aucun plan, et seulement dans ce cas. Dès qu'un plan existe, l'état suit le
   * dernier résultat : `failed` si la dernière exécution terminée d'au moins un plan a échoué,
   * `operational` si un plan au moins a un résultat et qu'aucun n'a échoué, `pending` tant
   * qu'aucun plan n'a de résultat (jamais lancé, ou première exécution en cours).
   */
  state: BackupOverviewState;
  plans: {
    total: number;
    /** Plans dont la dernière exécution a réussi (aucun plan n'est suspendu : tous sont actifs). */
    operational: number;
    /** Plans dont une exécution est en cours. */
    running: number;
    /** Plans dont un lancement manuel attend la fin de la sauvegarde en cours. */
    queued: number;
  };
  /** Fin de la dernière exécution réussie, tous plans confondus ; `null` si aucune. */
  lastBackupAt: string | null;
}

/**
 * `GET /api/overview` : les trois informations de l'accueil en une requête. Compteurs et dates
 * seulement, sans nom de plan ni détail d'erreur ; ouvert à l'opérateur (lecture seule). Simple
 * lecture de métadonnées, hors journal d'audit (ADR 0002).
 */
export function registerOverviewRoutes(
  scope: FastifyInstance,
  plans: SqlitePlanStore | undefined,
  queue?: { isQueued(planId: string): boolean },
) {
  scope.get('/api/overview', (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
    if (!plans) return reply.code(503).send({ error: 'plans_unavailable' });
    const all = plans.list();
    let operational = 0;
    let failed = 0;
    let ran = 0;
    let running = 0;
    let queued = 0;
    let lastBackupMs = Number.NEGATIVE_INFINITY;
    let lastBackupAt: string | null = null;
    for (const plan of all) {
      const runs = plans.listRuns(plan.id, RUNS_LIMIT);
      // Une exécution en cours n'est pas un résultat : on lit la dernière terminée.
      const latest = runs.find((r) => r.status !== 'running');
      if (latest) ran += 1;
      if (latest?.status === 'success') operational += 1;
      if (latest?.status === 'failed') failed += 1;
      // Mêmes règles que `GET /api/plans` : en cours prime, la file est celle du planificateur.
      if (runs.some((r) => r.status === 'running')) running += 1;
      else if (queue?.isQueued(plan.id)) queued += 1;
      for (const run of runs) {
        if (run.status !== 'success' || run.finishedAt === null) continue;
        const ms = Date.parse(run.finishedAt);
        if (!Number.isNaN(ms) && ms > lastBackupMs) {
          lastBackupMs = ms;
          lastBackupAt = run.finishedAt;
        }
      }
    }
    const state: BackupOverviewState =
      all.length === 0
        ? 'unconfigured'
        : failed > 0
          ? 'failed'
          : ran === 0
            ? 'pending'
            : 'operational';
    const overview: Overview = {
      state,
      plans: { total: all.length, operational, running, queued },
      lastBackupAt,
    };
    return overview;
  });
}
