/** Réponse de `GET /api/health`, partagée entre le serveur et l'interface. */
export interface HealthResponse {
  status: 'ok';
  version: string;
}

export function healthResponse(version: string): HealthResponse {
  return { status: 'ok', version };
}
