import { buildStatusReport, type BackupCatalog, type Workload } from '@backup365/core';
import type { FastifyInstance } from 'fastify';

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
) {
  scope.get('/api/status', async (_req, reply) => {
    if (!catalog) return reply.code(503).send({ error: 'catalog_unavailable' });
    return buildStatusReport(catalog, options.workloads, options.maxAgeHours);
  });
}
