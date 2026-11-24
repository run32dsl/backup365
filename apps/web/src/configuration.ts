import { requestError } from './apiError.js';

/** Réponse de `GET /api/configuration` : des états seulement, jamais un secret ni un identifiant. */
export interface Configuration {
  microsoft: { connected: boolean };
  workloads: string[];
}

/** État de la configuration (administrateur seulement). Une seule requête, en lecture. */
export async function fetchConfiguration(fetchFn: typeof fetch = fetch): Promise<Configuration> {
  const res = await fetchFn('/api/configuration');
  if (!res.ok) throw requestError(res);
  return (await res.json()) as Configuration;
}
