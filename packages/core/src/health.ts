/** Réponse de `GET /api/health`, partagée entre le serveur et l'interface. */
export interface HealthResponse {
  status: 'ok';
  version: string;
  /** Présent (`true`) seulement en mode démo : l'interface affiche alors son bandeau. */
  demo?: true;
}

export function healthResponse(version: string, demo = false): HealthResponse {
  return demo ? { status: 'ok', version, demo: true } : { status: 'ok', version };
}
