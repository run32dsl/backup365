import type { Workload } from '@backup365/core';
import type { FastifyInstance } from 'fastify';

/** État de la configuration, tel que l'affiche le bloc « Configuration » de la page d'accueil. */
export interface ConfigurationView {
  /** Identifiants de l'application Microsoft 365 renseignés côté serveur : les plans s'exécutent. */
  microsoft: { connected: boolean };
  /** Charges suivies par la console. */
  workloads: Workload[];
}

/**
 * `GET /api/configuration` : lecture seule, réservée aux administrateurs (403 sinon). Elle ne
 * renvoie que des états : ni secret, ni identifiant de tenant, ni identifiant d'application.
 */
export function registerConfigurationRoutes(
  app: FastifyInstance,
  options: { backupConfigured: boolean; workloads: readonly Workload[] },
) {
  app.get('/api/configuration', (req, reply) => {
    if (!req.session) return reply.code(401).send({ error: 'unauthenticated' });
    if (req.session.role !== 'admin') return reply.code(403).send({ error: 'forbidden' });
    const view: ConfigurationView = {
      microsoft: { connected: options.backupConfigured },
      workloads: [...options.workloads],
    };
    return view;
  });
}
