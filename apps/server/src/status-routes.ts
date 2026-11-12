import {
  buildStatusReport,
  type BackupCatalog,
  type SearchIndex,
  type Workload,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import type { SearchIndexer } from './search-indexer.js';

export interface StatusOptions {
  maxAgeHours: number;
  workloads: readonly Workload[];
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
  indexing?: { index?: SearchIndex | undefined; indexer?: SearchIndexer | undefined },
) {
  scope.get('/api/status', async (_req, reply) => {
    if (!catalog) return reply.code(503).send({ error: 'catalog_unavailable' });
    const report = await buildStatusReport(catalog, options.workloads, options.maxAgeHours);
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
