import { isAuditAction, type AuditAction, type AuditEntry } from '@backup365/core';

export interface AuditQuery {
  from?: string;
  to?: string;
  actor?: string;
  action?: AuditAction;
  /** `routine` : le serveur masque connexions, déconnexions et consultations du journal. */
  hide?: 'routine';
  limit?: number;
  offset?: number;
}

/** Entrée du journal ; pour un mail, l'API ajoute son objet et sa boîte quand l'index les connaît. */
export type AuditItem = AuditEntry & { targetName?: string; targetMailbox?: string };

export interface AuditResponse {
  /** Entrées qui répondent aux filtres, masque compris. */
  total: number;
  /** Entrées masquées par `hide=routine` (0 sans masque). */
  hidden?: number;
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
export const DATE_FORMAT_ERROR = 'Saisissez la date au format jj/mm/aaaa, par exemple 18/11/2026';

/** Message sous un champ de date au bon format mais qui n'existe pas. */
export const dateMissingError = (text: string): string => `Cette date n’existe pas (${text})`;

/** Message sous un champ de date hors des bornes acceptées. */
export const DATE_RANGE_ERROR = 'Date trop éloignée';

/** Message au-dessus de la liste quand un filtre de date refusé n'a pas été appliqué. */
export const FILTER_NOT_APPLIED =
  'Filtre non appliqué : corrigez la date pour filtrer. La liste affichée n’est pas filtrée.';

/** Message sous « Au » quand « Du » est postérieur. */
export const RANGE_ERROR = 'La date « Au » doit être égale ou postérieure à « Du »';

/** Exemple de format sous « Du (UTC) » et « Au (UTC) » ; le fuseau est dans le libellé. */
export const DATE_HELP = 'jj/mm/aaaa';

/** Début du jour UTC (ms) d'une date « jj/mm/aaaa » existante, ou le message du refus. */
function parseDay(text: string): { ms: number } | { error: string } {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return { error: DATE_FORMAT_ERROR };
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? { ms }
    : { error: dateMissingError(text) };
}

/** Dernier jour saisissable (31/12/9999) : accepté en « Du », refusé en « Au ». */
const LAST_DAY = Date.UTC(9999, 11, 31);

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
 * borne vide et un message ; « Du » postérieur à « Au » donne un message sous « Au ». « Au » au
 * 31/12/9999 est refusé : son lendemain (borne exclue) ne tient plus dans une année à 4 chiffres
 * et le serveur le rejetterait.
 */
export function dateRange(fromText: string, toText: string): DateRange {
  const out: DateRange = { from: '', to: '' };
  const fromParsed = fromText === '' ? null : parseDay(fromText);
  const toParsed = toText === '' ? null : parseDay(toText);
  const from = fromParsed && 'ms' in fromParsed ? fromParsed.ms : null;
  const toDay = toParsed && 'ms' in toParsed ? toParsed.ms : null;
  const to = toDay !== null && toDay >= LAST_DAY ? null : toDay;
  if (from !== null) out.from = new Date(from).toISOString();
  else if (fromParsed && 'error' in fromParsed) out.fromError = fromParsed.error;
  if (to !== null && from !== null && from > to) out.toError = RANGE_ERROR;
  else if (to !== null) out.to = new Date(to + 86_400_000).toISOString();
  else if (toDay !== null) out.toError = DATE_RANGE_ERROR;
  else if (toParsed && 'error' in toParsed) out.toError = toParsed.error;
  return out;
}

/** Vrai quand un filtre de date est refusé : la liste affichée n'est alors pas filtrée. */
export const hasDateError = (errors: DateRange): boolean =>
  errors.fromError !== undefined || errors.toError !== undefined;

/**
 * Décision de soumission d'un formulaire de filtres : `query` est `null` (aucune requête) tant
 * qu'une date est invalide, et `errors` porte alors les messages à afficher sous les champs.
 */
export function submitFilters<Q>(
  form: FormData,
  fromName: string,
  toName: string,
  build: (form: FormData) => Q,
): { errors: DateRange; query: Q | null } {
  const errors = dateRange(formText(form, fromName), formText(form, toName));
  const invalid = errors.fromError !== undefined || errors.toError !== undefined;
  return { errors, query: invalid ? null : build(form) };
}

/** Valeur texte (rognée) d'un champ du formulaire. */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Nombre d'entrées par page de l'écran. */
export const AUDIT_PAGE_SIZE = 25;

/** Valeur de l'option « Toutes » du sélecteur « Action » : rien n'est masqué. */
export const ALL_ACTIONS = 'all';

/** Vue par défaut (option « Toutes sauf connexions ») : connexions et consultations du journal masquées. */
export const DEFAULT_AUDIT_QUERY: AuditQuery = {
  limit: AUDIT_PAGE_SIZE,
  offset: 0,
  hide: 'routine',
};

/** Phrase qui dit combien d'entrées le masque par défaut cache ; vide quand rien n'est masqué. */
export function hiddenNotice(hidden: number | undefined): string {
  if (!hidden) return '';
  return hidden === 1
    ? '1 connexion ou consultation du journal masquée'
    : `${hidden} connexions et consultations du journal masquées`;
}

/**
 * Requête issue du formulaire de filtres : retour à la première page, dates jj/mm/aaaa converties
 * en intervalle UTC. Action du vocabulaire : filtre sur elle ; « Toutes » : aucun masque ; sinon
 * (« Toutes sauf connexions », valeur par défaut) : masque des entrées de routine.
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
    ...(isAuditAction(action)
      ? { action }
      : action === ALL_ACTIONS
        ? {}
        : { hide: 'routine' as const }),
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
