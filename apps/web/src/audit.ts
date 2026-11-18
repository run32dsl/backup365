import { isAuditAction, type AuditAction, type AuditEntry } from '@backup365/core';

export interface AuditQuery {
  from?: string;
  to?: string;
  actor?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

/** Entrée du journal ; pour un mail, l'API ajoute son objet et sa boîte quand l'index les connaît. */
export type AuditItem = AuditEntry & { targetName?: string; targetMailbox?: string };

export interface AuditResponse {
  total: number;
  limit: number;
  offset: number;
  items: AuditItem[];
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

/** Message sous un champ de date saisi dans un autre format que jj/mm/aaaa. */
export const DATE_ERROR = 'Date attendue au format jj/mm/aaaa';

/** Aide des champs « Du » et « Au ». */
export const DATE_HELP = 'Date au format jj/mm/aaaa, en UTC comme le tableau';

/** Début du jour UTC (ms) d'une date « jj/mm/aaaa » existante ; `null` si le format ou la date est invalide. */
function parseDay(text: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? ms
    : null;
}

export interface DateRange {
  /** Bornes ISO 8601 UTC : `from` inclus, `to` exclu (lendemain 00:00 du jour saisi) ; vides si non saisies. */
  from: string;
  to: string;
  fromError?: string;
  toError?: string;
}

/**
 * Filtres « Du » et « Au » (jj/mm/aaaa, tous deux inclus) en intervalle UTC [début du jour « Du »,
 * début du lendemain de « Au »[. Un champ vide n'est pas une erreur ; une date invalide donne une
 * borne vide et un message.
 */
export function dateRange(fromText: string, toText: string): DateRange {
  const out: DateRange = { from: '', to: '' };
  const from = fromText === '' ? null : parseDay(fromText);
  const to = toText === '' ? null : parseDay(toText);
  if (from !== null) out.from = new Date(from).toISOString();
  else if (fromText !== '') out.fromError = DATE_ERROR;
  if (to !== null) out.to = new Date(to + 86_400_000).toISOString();
  else if (toText !== '') out.toError = DATE_ERROR;
  return out;
}

/** Valeur texte (rognée) d'un champ du formulaire. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Nombre d'entrées par page de l'écran. */
export const AUDIT_PAGE_SIZE = 25;

/**
 * Requête issue du formulaire de filtres : retour à la première page, dates jj/mm/aaaa converties
 * en intervalle UTC, action hors vocabulaire ignorée.
 */
export function queryFromForm(form: FormData): AuditQuery {
  const text = (name: string): string => formText(form, name);
  const action = text('action');
  const range = dateRange(text('from'), text('to'));
  return {
    limit: AUDIT_PAGE_SIZE,
    offset: 0,
    from: range.from,
    to: range.to,
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
