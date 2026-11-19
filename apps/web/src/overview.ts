/** Réponse de `GET /api/overview` : les trois informations de l'accueil (voir overview-routes.ts du serveur). */
export interface Overview {
  /** `unconfigured` : aucun plan. `pending` : des plans, mais aucun résultat encore. */
  state: 'operational' | 'unconfigured' | 'pending' | 'failed';
  plans: { total: number; operational: number };
  lastBackupAt: string | null;
}

/** Interroge `/api/overview` ; lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchOverview(fetchFn: typeof fetch = fetch): Promise<Overview> {
  const res = await fetchFn('/api/overview');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Overview;
}
