/** Réponse de `GET /api/overview` : les trois informations de l'accueil (voir overview-routes.ts du serveur). */
export interface Overview {
  /** `unconfigured` : aucun plan. `pending` : des plans, mais aucun résultat encore. */
  state: 'operational' | 'unconfigured' | 'pending' | 'failed';
  /** `running` et `queued` : plans en cours et plans en file, comme dans la liste des plans. */
  plans: {
    total: number;
    operational: number;
    running: number;
    queued: number;
    /** Plans en échec et en retard, comme dans la liste des plans. */
    failed: number;
    late: number;
    /** Plans sans aucune exécution terminée : ni à jour, ni en retard, ni en échec. */
    waiting: number;
  };
  lastBackupAt: string | null;
  /** Nom du plan de cette exécution. */
  lastBackupPlan: string | null;
  /** Plan dont la dernière exécution a échoué (le plus récent) et fin de cette exécution ; `null` sinon. */
  lastFailure: { plan: string; at: string } | null;
  /** Sauvegardes au-delà du seuil de retard, calculées par le serveur comme la page Sources. */
  lateBackups: {
    service: 'mail' | 'onedrive' | 'sharepoint';
    name: string;
    lastSnapshotAt: string;
  }[];
}

/** Interroge `/api/overview` ; lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchOverview(fetchFn: typeof fetch = fetch): Promise<Overview> {
  const res = await fetchFn('/api/overview');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Overview;
}
