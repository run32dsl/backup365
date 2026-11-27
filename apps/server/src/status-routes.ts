import {
  annotateFailures,
  buildPlanComplianceReport,
  buildServiceSummaries,
  type StatusRow,
  buildStatusReport,
  type BackupCatalog,
  type SearchIndex,
  type Workload,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import type { SearchIndexer } from './search-indexer.js';
import type { StorageCheck } from './storage-check.js';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

/** Exécutions relues par plan : assez pour retrouver la dernière réussite après une série d'échecs. */
const COMPLIANCE_RUNS_LIMIT = 500;

export interface StatusOptions {
  maxAgeHours: number;
  workloads: readonly Workload[];
  /** Ancrage externe de la tête du journal d'audit (ADR 0004) ; absent : rien n'est exposé. */
  auditAnchor?: { configured: true } | { configured: false; reason: string };
  /** Sonde du stockage (écritures conditionnelles, SDK 7.2.0) ; absente sans stockage configuré. */
  storage?: StorageCheck | undefined;
}

/** Conformité de tous les plans ; `null` si leur base ne répond pas (le tableau reste servi). */
function planCompliance(
  store: SqlitePlanStore,
  rows: readonly StatusRow[],
  log: { warn(obj: object, msg: string): void },
) {
  try {
    return buildPlanComplianceReport(
      store.list(),
      (id) => store.listRuns(id, COMPLIANCE_RUNS_LIMIT),
      new Date(),
      rows,
    );
  } catch (err) {
    // Code technique seul : jamais de message ni de nom de plan.
    log.warn({ code: (err as NodeJS.ErrnoException).code }, 'conformité des plans indisponible');
    return null;
  }
}

/** Lignes rattachées à l'échec du plan qui les couvre ; inchangées si la base des plans ne répond pas. */
function withFailures(
  store: SqlitePlanStore,
  rows: StatusRow[],
  log: { warn(obj: object, msg: string): void },
): StatusRow[] {
  try {
    return annotateFailures(rows, store.list(), (id) => store.listRuns(id, COMPLIANCE_RUNS_LIMIT));
  } catch (err) {
    log.warn({ code: (err as NodeJS.ErrnoException).code }, 'échecs des plans indisponibles');
    return rows;
  }
}

/** Une ligne par service (page « Sources ») ; `null` si la base des plans ne répond pas. */
function serviceSummaries(
  store: SqlitePlanStore,
  rows: readonly StatusRow[],
  maxAgeHours: number,
  log: { warn(obj: object, msg: string): void },
) {
  try {
    return buildServiceSummaries(rows, store.list(), maxAgeHours);
  } catch (err) {
    log.warn({ code: (err as NodeJS.ErrnoException).code }, 'synthèse des services indisponible');
    return null;
  }
}

/**
 * `GET /api/status` : état de la dernière sauvegarde par boîte et par charge. Simple lecture de
 * métadonnées du catalogue, hors journal d'audit (ADR 0002). Sans catalogue, ou si le SDK échoue
 * (gestionnaire d'erreurs du plugin du catalogue), la réponse est un 503 sans détail.
 */
export function registerStatusRoutes(
  scope: FastifyInstance,
  catalog: BackupCatalog | undefined,
  options: StatusOptions,
  indexing?: {
    index?: SearchIndex | undefined;
    indexer?: SearchIndexer | undefined;
    plans?: SqlitePlanStore | undefined;
  },
) {
  scope.get('/api/status', async (req, reply) => {
    if (!catalog) return reply.code(503).send({ error: 'catalog_unavailable' });
    const admin = req.session?.role === 'admin';
    // Écritures conditionnelles du stockage : le détail est une question d'exploitation, réservée
    // aux administrateurs ; les autres rôles n'apprennent que la suspension des restaurations
    // (#614). La sonde (jamais rejetée, mise en cache) tourne pendant la lecture du catalogue.
    const probe = options.storage?.conditionalWrites();
    const catalogReport = await buildStatusReport(catalog, options.workloads, options.maxAgeHours);
    // Conformité des plans : réservée aux administrateurs par décision du PO du 2026-11-16, en
    // attente de #86, donc absente pour tout autre rôle et sans session ; absente sans base des plans, `null` si elle ne répond pas.
    const store = admin ? indexing?.plans : undefined;
    const rows = store ? withFailures(store, catalogReport.rows, req.log) : catalogReport.rows;
    const withPlans = store
      ? {
          ...catalogReport,
          rows,
          plans: planCompliance(store, catalogReport.rows, req.log),
          services: serviceSummaries(store, rows, options.maxAgeHours, req.log),
        }
      : catalogReport;
    const conditionalWrites = probe ? await probe : undefined;
    const base =
      conditionalWrites === undefined
        ? withPlans
        : admin
          ? { ...withPlans, storage: { conditionalWrites } }
          : { ...withPlans, restoreSuspended: conditionalWrites === 'ignored' };
    const report = options.auditAnchor
      ? {
          ...base,
          auditAnchor: options.auditAnchor.configured
            ? { configured: true, label: 'ancrage du journal : configuré' }
            : {
                configured: false,
                label: 'ancrage du journal : non configuré',
                reason: options.auditAnchor.reason,
              },
        }
      : base;
    if (!indexing?.index) return report;
    // Nombre de mails indexés : `null` si l'index ne répond pas, sans faire échouer le tableau.
    const mails = await indexing.index
      .search({ limit: 1, offset: 0 })
      .then((page) => page.total)
      .catch(() => null);
    const state = indexing.indexer?.status();
    return {
      ...report,
      index: {
        mails,
        lastRunAt: state?.lastRunAt ?? null,
        lastSuccessAt: state?.lastSuccessAt ?? null,
        lastRunFailed: state?.lastRunFailed ?? false,
      },
    };
  });
}
