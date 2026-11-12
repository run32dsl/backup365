import { isAuditAction, type AuditAction, type AuditEntry } from '@backup365/core';

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

/** Nombre d'entrées par page de l'écran. */
export const AUDIT_PAGE_SIZE = 50;

/**
 * Requête issue du formulaire de filtres : retour à la première page, dates locales converties
 * en UTC, action hors vocabulaire ignorée.
 */
export function queryFromForm(form: FormData): AuditQuery {
  const text = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value.trim() : '';
  };
  const action = text('action');
  return {
    limit: AUDIT_PAGE_SIZE,
    offset: 0,
    from: toUtcIso(text('from')),
    to: toUtcIso(text('to')),
    actor: text('actor'),
    ...(isAuditAction(action) ? { action } : {}),
  };
}

/** Décalages des pages précédente et suivante ; `null` quand il n'y en a pas. */
export function pageOffsets(
  offset: number,
  limit: number,
  total: number,
): { previous: number | null; next: number | null } {
  return {
    previous: offset > 0 ? Math.max(0, offset - limit) : null,
    next: offset + limit < total ? offset + limit : null,
  };
}
