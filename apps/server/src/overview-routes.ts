import {
  alignCompliance,
  alignRunEnd,
  buildStatusReport,
  lateBackups,
  planCompliance,
  type BackupCatalog,
  type LateBackup,
  type StatusRow,
  type Workload,
} from '@backup365/core';
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
    /** Plans à jour, au sens de la liste des plans (« À jour » : réussite plus récente que le RPO). */
    operational: number;
    /** Plans dont une exécution est en cours. */
    running: number;
    /** Plans dont un lancement manuel attend la fin de la sauvegarde en cours. */
    queued: number;
    /** Plans « en échec » et « en retard », au sens de la liste des plans. */
    failed: number;
    late: number;
    /**
     * Plans sans aucune exécution terminée (jamais lancés, ou première exécution en cours) : ni à
     * jour, ni en retard, ni en échec ; ils attendent leur première sauvegarde.
     */
    waiting: number;
  };
  /** Fin de la dernière exécution réussie, tous plans confondus ; `null` si aucune. */
  lastBackupAt: string | null;
  /** Nom du plan de cette exécution ; `null` si aucune. */
  lastBackupPlan: string | null;
  /**
   * Échec le plus récent parmi les plans dont la dernière exécution terminée a échoué : nom du plan
   * et fin de l'exécution. `null` si aucun plan n'est dans ce cas.
   */
  lastFailure: { plan: string; at: string } | null;
  /**
   * Sauvegardes au-delà du seuil de retard (par boîte, compte ou site), calculées comme la page
   * « Sources » (`lateBackups`). Vide sans catalogue ou si celui-ci ne répond pas.
   */
  lateBackups: LateBackup[];
}

/** Mêmes lignes que `GET /api/status` ; un catalogue qui ne répond pas ne fait pas échouer l'accueil. */
export async function catalogRowsOf(
  late: CatalogAccess | undefined,
  log: { warn(obj: object, msg: string): void },
): Promise<StatusRow[] | undefined> {
  if (!late?.catalog) return undefined;
  try {
    return (await buildStatusReport(late.catalog, late.workloads, late.maxAgeHours)).rows;
  } catch (err) {
    log.warn({ code: (err as NodeJS.ErrnoException).code }, 'sauvegardes en retard indisponibles');
    return undefined;
  }
}

export interface CatalogAccess {
  catalog: BackupCatalog | undefined;
  maxAgeHours: number;
  workloads: readonly Workload[];
}

/**
 * `GET /api/overview` : les trois informations de l'accueil en une requête. Compteurs, dates et
 * nom du plan de la dernière réussite, sans détail d'erreur ; ouvert à l'opérateur (lecture seule). Simple
 * lecture de métadonnées, hors journal d'audit (ADR 0002).
 */
export function registerOverviewRoutes(
  scope: FastifyInstance,
  plans: SqlitePlanStore | undefined,
  queue?: { isQueued(planId: string): boolean },
  late?: CatalogAccess,
) {
  scope.get('/api/overview', async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
    if (!plans) return reply.code(503).send({ error: 'plans_unavailable' });
    const all = plans.list();
    const rows = await catalogRowsOf(late, req.log);
    let operational = 0;
    let failed = 0;
    let failedPlans = 0;
    let latePlans = 0;
    let waiting = 0;
    const now = new Date();
    let ran = 0;
    let running = 0;
    let queued = 0;
    let lastBackupMs = Number.NEGATIVE_INFINITY;
    let lastBackupAt: string | null = null;
    let lastBackupPlan: string | null = null;
    let lastFailureMs = Number.NEGATIVE_INFINITY;
    let lastFailure: Overview['lastFailure'] = null;
    for (const plan of all) {
      const runs = plans.listRuns(plan.id, RUNS_LIMIT);
      // Une exécution en cours n'est pas un résultat : on lit la dernière terminée.
      const latest = runs.find((r) => r.status !== 'running');
      if (latest) ran += 1;

      if (latest?.status === 'failed') {
        failed += 1;
        const at = latest.finishedAt ?? latest.startedAt;
        const ms = Date.parse(at);
        if (!Number.isNaN(ms) && ms > lastFailureMs) {
          lastFailureMs = ms;
          lastFailure = { plan: plan.name, at };
        }
      }
      // « En échec » : conformité en échec ou dernière exécution (celle de la liste) en échec ;
      // la liste filtrée de « Voir l'erreur » applique la même règle.
      const compliance = alignCompliance(
        planCompliance(plan.rpoHours, runs, now),
        plan,
        rows,
      ).state;
      // Sans exécution terminée, un plan n'a pas encore de retard : il attend (#600).
      if (!latest) waiting += 1;
      else if (compliance === 'failed' || runs[0]?.status === 'failed') failedPlans += 1;
      else if (compliance === 'compliant') operational += 1;
      else latePlans += 1;
      // Mêmes règles que `GET /api/plans` : en cours prime, la file est celle du planificateur.
      if (runs.some((r) => r.status === 'running')) running += 1;
      else if (queue?.isQueued(plan.id)) queued += 1;
      for (const run of runs) {
        if (run.status !== 'success' || run.finishedAt === null) continue;
        // Même borne que la liste des plans : jamais plus récent que les sauvegardes listées.
        const end = alignRunEnd(run, plan, rows) ?? run.finishedAt;
        const ms = Date.parse(end);
        if (!Number.isNaN(ms) && ms > lastBackupMs) {
          lastBackupMs = ms;
          lastBackupAt = end;
          lastBackupPlan = plan.name;
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
      plans: {
        total: all.length,
        operational,
        running,
        queued,
        failed: failedPlans,
        late: latePlans,
        waiting,
      },
      lastBackupAt,
      lastBackupPlan,
      lastFailure,
      lateBackups: rows ? lateBackups(rows) : [],
    };
    return overview;
  });
}
