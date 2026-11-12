import type { AuditAction, AuditEntry } from '@backup365/core';

export interface AuditQuery {
  from?: string;
  to?: string;
  actor?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

export interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditEntry[];
}

/** Interroge `/api/audit` ; les filtres vides sont omis. Lève une erreur si la réponse n'est pas en 2xx. */
export async function fetchAudit(
  query: AuditQuery,
  fetchFn: typeof fetch = fetch,
): Promise<AuditResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const res = await fetchFn(`/api/audit?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AuditResponse;
}

/** Valeur d'un `<input type="datetime-local">` (heure locale) en date UTC ISO 8601 ; vide si invalide. */
export function toUtcIso(local: string): string {
  const date = new Date(local);
  return local === '' || isNaN(date.getTime()) ? '' : date.toISOString();
}
