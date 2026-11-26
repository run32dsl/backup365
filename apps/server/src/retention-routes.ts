import {
  CatalogUnavailableError,
  isWorkload,
  NoBackupFoundError,
  retentionExcess,
  type AuditLog,
  type BackupCatalog,
  type DataType,
  type Snapshot,
  type Workload,
} from '@backup365/core';
import type { FastifyInstance } from 'fastify';
import { recordDenied } from './audit-events.js';
import { listPlanItems } from './plan-items.js';
import type { SqlitePlanStore } from './sqlite/sqlite-plan-store.js';

/**
 * `GET /api/plans/retention` (issue #79, ADR 0009) : pour chaque plan, ce qui dépasse sa durée de
 * conservation (instantanés, éléments, volume). **Simulation** : rien n'est supprimé ni verrouillé,
 * `retention` reste `not_enforced`. Réservée aux administrateurs. Simple lecture de métadonnées
 * du catalogue (dates et tailles), hors journal d'audit comme les autres listes (ADR 0002).
 */
export function registerRetentionRoutes(
  app: FastifyInstance,
  plans: SqlitePlanStore | undefined,
  catalog: BackupCatalog | undefined,
  audit: AuditLog | undefined,
) {
  app.get('/api/plans/retention', async (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
    if (req.session.role !== 'admin') {
      if (audit) await recordDenied(audit, req, 'plans', 'forbidden');
      return reply.code(403).send({ error: 'forbidden' });
    }
    if (!plans) return reply.code(503).send({ error: 'plans_unavailable' });
    if (!catalog) return reply.code(503).send({ error: 'catalog_unavailable' });
    const now = new Date();
    // Un élément commun à plusieurs plans n'est lu qu'une fois par requête.
    const cache = new Map<string, Promise<Snapshot[]>>();
    const snapshotsOf = (item: string, type: Workload): Promise<Snapshot[]> => {
      const key = `${type}:${item}`;
      let found = cache.get(key);
      if (!found) {
        found =
          type === 'sharepoint'
            ? catalog.listSiteSnapshots(item)
            : catalog.listSnapshots(item, type);
        cache.set(key, found);
      }
      return found;
    };
    try {
      const all = plans.list();
      // Un site n'est lu que pour SharePoint, une boîte que pour la messagerie et OneDrive :
      // un identifiant de site n'est jamais envoyé aux listes de boîtes du SDK, ni l'inverse.
      const sites = all.some((p) => p.dataTypes.includes('sharepoint'))
        ? new Set((await catalog.listSites()).map((s) => s.id))
        : new Set<string>();
      const items = [];
      for (const plan of all) {
        const byItem = new Map<string, Snapshot[]>();
        for (const item of await listPlanItems(plan, catalog)) {
          // L'agenda n'est pas lu : le catalogue ne liste pas ses instantanés (ADR 0009).
          const types = plan.dataTypes
            .filter((t): t is Extract<DataType, Workload> => isWorkload(t))
            .filter((t) => (t === 'sharepoint') === sites.has(item));
          const found: Snapshot[] = [];
          for (const type of types) found.push(...(await snapshotsOf(item, type)));
          byItem.set(item, found);
        }
        items.push({
          planId: plan.id,
          retentionDays: plan.retentionDays,
          ...retentionExcess(plan.retentionDays, byItem, now),
        });
      }
      return { retention: 'not_enforced', simulation: true, computedAt: now.toISOString(), items };
    } catch (err) {
      // Aucune sauvegarde encore : rien ne peut dépasser la durée.
      if (err instanceof NoBackupFoundError) {
        const items = plans.list().map((plan) => ({
          planId: plan.id,
          retentionDays: plan.retentionDays,
          ...retentionExcess(plan.retentionDays, new Map(), now),
        }));
        return {
          retention: 'not_enforced',
          simulation: true,
          computedAt: now.toISOString(),
          items,
        };
      }
      if (err instanceof CatalogUnavailableError) {
        // Ni cause ni trace : le message du SDK peut contenir un nom de bucket.
        req.log.warn({ errorName: err.name }, 'simulation de conservation indisponible');
        return reply.code(503).send({ error: 'catalog_unavailable' });
      }
      throw err;
    }
  });
}
